package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

var (
	configPathLock sync.Mutex
	customConfigPath string
)

func GetConfigPath() string {
	configPathLock.Lock()
	defer configPathLock.Unlock()
	if customConfigPath != "" {
		return customConfigPath
	}

	if dataDir != "." {
		return filepath.Join(dataDir, "rclone.conf")
	}

	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData != "" {
			return filepath.Join(appData, "rclone", "rclone.conf")
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "rclone.conf" // fallback to local
	}
	if runtime.GOOS == "windows" {
		return filepath.Join(home, "AppData", "Roaming", "rclone", "rclone.conf")
	}
	return filepath.Join(home, ".config", "rclone", "rclone.conf")
}

func SetConfigPath(path string) {
	configPathLock.Lock()
	defer configPathLock.Unlock()
	customConfigPath = path
}

// ParseINI reads the INI config file and returns structured data: remoteName -> (key -> value)
func ParseINI(path string) (map[string]map[string]string, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return make(map[string]map[string]string), nil
	} else if err != nil {
		return nil, err
	}
	defer file.Close()

	remotes := make(map[string]map[string]string)
	var currentRemote string

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") {
			continue
		}

		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			currentRemote = line[1 : len(line)-1]
			remotes[currentRemote] = make(map[string]string)
		} else if currentRemote != "" {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				value := strings.TrimSpace(parts[1])
				remotes[currentRemote][key] = value
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return remotes, nil
}

// SerializeINI writes the remotes map back to the INI config file
func SerializeINI(path string, remotes map[string]map[string]string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := bufio.NewWriter(file)
	for remoteName, params := range remotes {
		_, err := writer.WriteString(fmt.Sprintf("[%s]\n", remoteName))
		if err != nil {
			return err
		}
		for k, v := range params {
			_, err = writer.WriteString(fmt.Sprintf("%s = %s\n", k, v))
			if err != nil {
				return err
			}
		}
		_, err = writer.WriteString("\n")
		if err != nil {
			return err
		}
	}

	return writer.Flush()
}

// GetRawConfig returns the entire rclone.conf contents
func GetRawConfig(path string) (string, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return "", nil
	} else if err != nil {
		return "", err
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveRawConfig writes raw content directly to rclone.conf
func SaveRawConfig(path string, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0600)
}
