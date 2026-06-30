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
	ID               string    `json:"id"`
	Command          string    `json:"command"`
	Source           string    `json:"source"`
	Destination      string    `json:"destination"`
	Flags            []string  `json:"flags"`
	Status           string    `json:"status"` // running, success, failed, stopped
	Progress         float64   `json:"progress"`
	Speed            string    `json:"speed"`
	ETA              string    `json:"eta"`
	Transferred      string    `json:"transferred"`
	BytesTransferred string    `json:"bytesTransferred"`
	FilesTransferred string    `json:"filesTransferred"`
	ActiveThreads    int       `json:"activeThreads"`
	ActiveFiles      []string  `json:"activeFiles"`
	Logs             string    `json:"logs"`
	StartTime        string    `json:"startTime"`
	EndTime          string    `json:"endTime"`
	cmd              *exec.Cmd `json:"-"`
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
	id := strconv.FormatInt(time.Now().UnixNano(), 10)
	task := &Task{
		ID:          id,
		Command:     command,
		Source:      source,
		Destination: destination,
		Flags:       flags,
		Status:      "running",
		StartTime:   time.Now().Format(time.RFC3339),
	}

	tasksLock.Lock()
	tasks[id] = task
	saveTasks()
	tasksLock.Unlock()

	err := runTaskProcess(task)
	if err != nil {
		return "", err
	}

	return id, nil
}

func RestartTask(id string) error {
	tasksLock.Lock()
	task, ok := tasks[id]
	tasksLock.Unlock()

	if !ok {
		return fmt.Errorf("task not found")
	}

	if task.Status == "running" {
		return fmt.Errorf("task is already running")
	}

	tasksLock.Lock()
	task.Status = "running"
	task.Progress = 0
	task.Speed = ""
	task.ETA = ""
	task.Transferred = ""
	task.BytesTransferred = ""
	task.FilesTransferred = ""
	task.ActiveFiles = nil
	task.ActiveThreads = 0
	task.StartTime = time.Now().Format(time.RFC3339)
	task.EndTime = ""
	task.Logs = "[System] Task restarted by user.\n"
	saveTasks()
	tasksLock.Unlock()

	return runTaskProcess(task)
}

func runTaskProcess(task *Task) error {
	rclonePath, err := GetRclonePath()
	if err != nil {
		return err
	}

	if _, err := os.Stat(rclonePath); os.IsNotExist(err) {
		return fmt.Errorf("rclone is not installed; download it first")
	}

	// Build arguments
	args := []string{task.Command, task.Source, task.Destination, "-P"}
	args = append(args, task.Flags...)

	var cleanArgs []string
	for _, arg := range args {
		if strings.TrimSpace(arg) != "" {
			cleanArgs = append(cleanArgs, arg)
		}
	}

	cPath := GetConfigPath()
	if _, err := os.Stat(cPath); err == nil {
		cleanArgs = append(cleanArgs, "--config", cPath)
	}

	cmd := exec.Command(rclonePath, cleanArgs...)
	task.cmd = cmd

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		tasksLock.Lock()
		task.Status = "failed"
		task.EndTime = time.Now().Format(time.RFC3339)
		task.Logs = fmt.Sprintf("Failed to start process: %v", err)
		saveTasks()
		tasksLock.Unlock()
		return err
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
		if task.Logs != "" {
			logLines = strings.Split(task.Logs, "\n")
		}
		var activeFiles []string

		for scanner.Scan() {
			text := scanner.Text()
			cleanText := strings.TrimSpace(text)
			if cleanText == "" {
				continue
			}

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
					val := strings.TrimSpace(transMatch[1])
					tasksLock.Lock()
					task.Transferred = val
					if strings.Contains(val, "B") || strings.Contains(val, "b") || strings.Contains(val, "bytes") {
						task.BytesTransferred = val
					} else {
						task.FilesTransferred = val
					}
					tasksLock.Unlock()
				}

				activeFiles = nil
			} else if strings.HasPrefix(cleanText, "* ") {
				fileLine := strings.TrimPrefix(cleanText, "* ")
				parts := strings.SplitN(fileLine, ":", 2)
				if len(parts) > 0 {
					fileName := strings.TrimSpace(parts[0])
					if fileName != "" {
						activeFiles = append(activeFiles, fileName)
					}
				}
			}

			tasksLock.Lock()
			task.Logs = strings.Join(logLines, "\n")
			task.ActiveFiles = activeFiles
			task.ActiveThreads = len(activeFiles)
			tasksLock.Unlock()
		}

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

	return nil
}
