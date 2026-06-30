package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Task struct {
	ID          string    `json:"id"`
	Command     string    `json:"command"`
	Source      string    `json:"source"`
	Destination string    `json:"destination"`
	Flags       []string  `json:"flags"`
	Status      string    `json:"status"` // running, success, failed, stopped
	Progress    float64   `json:"progress"`
	Speed       string    `json:"speed"`
	ETA         string    `json:"eta"`
	Transferred string    `json:"transferred"`
	ActiveFiles []string  `json:"activeFiles"`
	Logs        string    `json:"logs"`
	StartTime   string    `json:"startTime"`
	EndTime     string    `json:"endTime"`
	cmd         *exec.Cmd `json:"-"`
}

var (
	tasks     = make(map[string]*Task)
	tasksLock sync.Mutex
	dbPath    = "tasks_db.json"
)

func InitTasks() {
	loadTasks()
}

func loadTasks() {
	tasksLock.Lock()
	defer tasksLock.Unlock()

	data, err := os.ReadFile(dbPath)
	if err != nil {
		return
	}

	var loaded []*Task
	if err := json.Unmarshal(data, &loaded); err != nil {
		return
	}

	for _, t := range loaded {
		// If a task was left running when server closed, mark as failed
		if t.Status == "running" {
			t.Status = "failed"
			t.EndTime = time.Now().Format(time.RFC3339)
			t.Logs += "\n[System] Server restarted, task terminated."
		}
		tasks[t.ID] = t
	}
}

func saveTasks() {
	var list []*Task
	for _, t := range tasks {
		list = append(list, t)
	}

	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return
	}

	_ = os.WriteFile(dbPath, data, 0644)
}

func GetTasks() []*Task {
	tasksLock.Lock()
	defer tasksLock.Unlock()

	var list []*Task
	for _, t := range tasks {
		list = append(list, t)
	}
	return list
}

func GetTask(id string) (*Task, bool) {
	tasksLock.Lock()
	defer tasksLock.Unlock()
	t, ok := tasks[id]
	return t, ok
}

func StopTask(id string) error {
	tasksLock.Lock()
	t, ok := tasks[id]
	tasksLock.Unlock()

	if !ok {
		return fmt.Errorf("task not found")
	}

	if t.Status != "running" || t.cmd == nil {
		return fmt.Errorf("task is not running")
	}

	// Kill the process group / process
	err := t.cmd.Process.Kill()
	if err != nil {
		return err
	}

	tasksLock.Lock()
	t.Status = "stopped"
	t.EndTime = time.Now().Format(time.RFC3339)
	t.Logs += "\n[System] Task stopped by user."
	saveTasks()
	tasksLock.Unlock()

	return nil
}

// splitLinesAndCarriageReturns splits on either \n or \r
func splitLinesAndCarriageReturns(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for i := 0; i < len(data); i++ {
		if data[i] == '\n' || data[i] == '\r' {
			return i + 1, data[0:i], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func StartTask(command, source, destination string, flags []string) (string, error) {
	rclonePath, err := GetRclonePath()
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(rclonePath); os.IsNotExist(err) {
		return "", fmt.Errorf("rclone is not installed; download it first")
	}

	id := strconv.FormatInt(time.Now().UnixNano(), 10)

	// Build the rclone arguments
	// Always append -P to get progress output
	args := []string{command, source, destination, "-P"}
	args = append(args, flags...)

	// Filter out empty flags
	var cleanArgs []string
	for _, arg := range args {
		if strings.TrimSpace(arg) != "" {
			cleanArgs = append(cleanArgs, arg)
		}
	}

	// Add config flag if config file exists
	cPath := GetConfigPath()
	if _, err := os.Stat(cPath); err == nil {
		cleanArgs = append(cleanArgs, "--config", cPath)
	}

	cmd := exec.Command(rclonePath, cleanArgs...)

	task := &Task{
		ID:          id,
		Command:     command,
		Source:      source,
		Destination: destination,
		Flags:       flags,
		Status:      "running",
		StartTime:   time.Now().Format(time.RFC3339),
		cmd:         cmd,
	}

	tasksLock.Lock()
	tasks[id] = task
	saveTasks()
	tasksLock.Unlock()

	// Get stderr and stdout pipes
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	cmd.Stderr = cmd.Stdout // Redirect stderr to stdout to parse progress from both

	if err := cmd.Start(); err != nil {
		task.Status = "failed"
		task.EndTime = time.Now().Format(time.RFC3339)
		task.Logs = fmt.Sprintf("Failed to start process: %v", err)
		tasksLock.Lock()
		saveTasks()
		tasksLock.Unlock()
		return "", err
	}

	// Regular expressions for progress parsing
	pctReg := regexp.MustCompile(`(\d+)%`)
	speedReg := regexp.MustCompile(`(\d+(?:\.\d+)?\s*[a-zA-Z]+/s)`)
	etaReg := regexp.MustCompile(`ETA\s*(\S+)`)
	transReg := regexp.MustCompile(`Transferred:\s*(\d+\s*/\s*\d+|\S+\s*/\s*\S+)`)

	go func() {
		reader := io.Reader(stdout)
		scanner := bufio.NewScanner(reader)
		scanner.Split(splitLinesAndCarriageReturns)

		var logLines []string
		var activeFiles []string

		for scanner.Scan() {
			text := scanner.Text()
			cleanText := strings.TrimSpace(text)
			if cleanText == "" {
				continue
			}

			// Save to log list (keep last 2000 lines to avoid high memory usage)
			logLines = append(logLines, cleanText)
			if len(logLines) > 2000 {
				logLines = logLines[1:]
			}

			// Parse overall progress info
			if strings.Contains(cleanText, "Transferred:") {
				// Parse percentage
				pctMatch := pctReg.FindStringSubmatch(cleanText)
				if len(pctMatch) > 1 {
					if p, err := strconv.ParseFloat(pctMatch[1], 64); err == nil {
						tasksLock.Lock()
						task.Progress = p
						tasksLock.Unlock()
					}
				}

				// Parse speed
				speedMatch := speedReg.FindStringSubmatch(cleanText)
				if len(speedMatch) > 1 {
					tasksLock.Lock()
					task.Speed = speedMatch[1]
					tasksLock.Unlock()
				}

				// Parse ETA
				etaMatch := etaReg.FindStringSubmatch(cleanText)
				if len(etaMatch) > 1 {
					tasksLock.Lock()
					task.ETA = etaMatch[1]
					tasksLock.Unlock()
				}

				// Parse files/bytes transferred
				transMatch := transReg.FindStringSubmatch(cleanText)
				if len(transMatch) > 1 {
					tasksLock.Lock()
					task.Transferred = transMatch[1]
					tasksLock.Unlock()
				}

				// If we hit "Transferred:" it means a progress block started
				// Reset active files list for the next block
				activeFiles = nil
			} else if strings.HasPrefix(cleanText, "* ") {
				// Parse active files: e.g. "* some_file.txt:  0% /1.234 MiB"
				fileLine := strings.TrimPrefix(cleanText, "* ")
				parts := strings.SplitN(fileLine, ":", 2)
				if len(parts) > 0 {
					fileName := strings.TrimSpace(parts[0])
					if fileName != "" {
						activeFiles = append(activeFiles, fileName)
					}
				}
			}

			// Update task in memory periodically
			tasksLock.Lock()
			task.Logs = strings.Join(logLines, "\n")
			task.ActiveFiles = activeFiles
			tasksLock.Unlock()
		}

		// Wait for command execution to finish
		err := cmd.Wait()
		tasksLock.Lock()
		task.EndTime = time.Now().Format(time.RFC3339)
		if task.Status == "running" {
			if err != nil {
				task.Status = "failed"
				task.Logs += fmt.Sprintf("\n[System] Process exited with error: %v", err)
			} else {
				task.Status = "success"
				task.Progress = 100
				task.Logs += "\n[System] Process finished successfully."
			}
		}
		saveTasks()
		tasksLock.Unlock()
	}()

	return id, nil
}
