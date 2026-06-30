package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

var (
	downloadStatus string
	downloadLock   sync.Mutex
)

// GetRclonePath returns the absolute path of the local rclone binary
func GetRclonePath() (string, error) {
	binDir := filepath.Join(dataDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return "", err
	}

	binaryName := "rclone"
	if runtime.GOOS == "windows" {
		binaryName = "rclone.exe"
	}

	return filepath.Join(binDir, binaryName), nil
}

// CheckRcloneVersion executes "rclone version" and returns the version string
func CheckRcloneVersion() (string, error) {
	path, err := GetRclonePath()
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		return "Not Installed", nil
	}

	cmd := exec.Command(path, "version")
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", err
	}

	lines := strings.Split(out.String(), "\n")
	if len(lines) > 0 {
		return strings.TrimSpace(lines[0]), nil
	}
	return "Unknown Version", nil
}

// GetDownloadStatus returns the current download status message
func GetDownloadStatus() string {
	downloadLock.Lock()
	defer downloadLock.Unlock()
	return downloadStatus
}

// setDownloadStatus updates the current download status message
func setDownloadStatus(status string) {
	downloadLock.Lock()
	defer downloadLock.Unlock()
	downloadStatus = status
}

// TriggerDownload runs the rclone download and extraction in the background
func TriggerDownload() {
	go func() {
		downloadLock.Lock()
		if downloadStatus != "" && !strings.HasPrefix(downloadStatus, "Failed") && !strings.HasPrefix(downloadStatus, "Finished") {
			downloadLock.Unlock()
			return // Already running
		}
		downloadStatus = "Initializing download..."
		downloadLock.Unlock()

		err := performDownload()
		if err != nil {
			setDownloadStatus(fmt.Sprintf("Failed: %v", err))
		} else {
			setDownloadStatus("Finished: Rclone successfully installed/updated.")
		}
	}()
}

func performDownload() error {
	osType := runtime.GOOS
	archType := runtime.GOARCH

	// Determine the zip download URL based on runtime OS and Arch
	var zipName string
	switch osType {
	case "windows":
		if archType == "amd64" {
			zipName = "rclone-current-windows-amd64.zip"
		} else if archType == "386" {
			zipName = "rclone-current-windows-386.zip"
		} else if archType == "arm64" {
			zipName = "rclone-current-windows-arm64.zip"
		} else {
			zipName = "rclone-current-windows-amd64.zip"
		}
	case "linux":
		if archType == "amd64" {
			zipName = "rclone-current-linux-amd64.zip"
		} else if archType == "arm64" {
			zipName = "rclone-current-linux-arm64.zip"
		} else {
			zipName = "rclone-current-linux-amd64.zip"
		}
	case "darwin": // macOS
		if archType == "arm64" {
			zipName = "rclone-current-osx-arm64.zip"
		} else {
			zipName = "rclone-current-osx-amd64.zip"
		}
	default:
		return fmt.Errorf("unsupported operating system: %s", osType)
	}

	zipBytes, err := downloadWithFallback(zipName, osType, archType)
	if err != nil {
		return err
	}

	setDownloadStatus("正在解压 rclone 主程序...")
	zipReader, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return fmt.Errorf("failed to parse zip file: %v", err)
	}

	binaryName := "rclone"
	if osType == "windows" {
		binaryName = "rclone.exe"
	}

	destPath, err := GetRclonePath()
	if err != nil {
		return err
	}

	found := false
	for _, file := range zipReader.File {
		// Inside the zip, files are in a subdirectory like rclone-v1.62.2-windows-amd64/rclone.exe
		// We want to find the file that ends with /rclone or /rclone.exe
		base := filepath.Base(file.Name)
		if base == binaryName {
			srcFile, err := file.Open()
			if err != nil {
				return fmt.Errorf("failed to open file inside zip: %v", err)
			}
			defer srcFile.Close()

			// Write to a temporary file first, then swap
			tempPath := destPath + ".tmp"
			destFile, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
			if err != nil {
				return fmt.Errorf("failed to create temporary file: %v", err)
			}
			defer destFile.Close()

			_, err = io.Copy(destFile, srcFile)
			if err != nil {
				return fmt.Errorf("failed to write binary: %v", err)
			}
			destFile.Close() // Close before rename

			// Check if destination exists and delete it (on windows, rename might fail if target exists)
			if _, err := os.Stat(destPath); err == nil {
				if err := os.Remove(destPath); err != nil {
					return fmt.Errorf("failed to remove existing binary: %v", err)
				}
			}

			if err := os.Rename(tempPath, destPath); err != nil {
				return fmt.Errorf("failed to move binary to destination: %v", err)
			}

			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("could not find binary %s in downloaded archive", binaryName)
	}

	setDownloadStatus("Verifying rclone version...")
	v, err := CheckRcloneVersion()
	if err != nil {
		return fmt.Errorf("verification failed: %v", err)
	}

	setDownloadStatus(fmt.Sprintf("Finished: Rclone version %s installed.", v))
	return nil
}

func getLatestGithubVersion() string {
	client := &http.Client{Timeout: 3 * time.Second}

	// Try 1: downloads.rclone.org/version.txt (Official plain text version file)
	if resp, err := client.Get("https://downloads.rclone.org/version.txt"); err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			if body, err := io.ReadAll(resp.Body); err == nil {
				text := strings.TrimSpace(string(body))
				if strings.HasPrefix(text, "rclone ") {
					return strings.TrimPrefix(text, "rclone ")
				}
			}
		}
	}

	// Try 2: Github API
	if resp, err := client.Get("https://api.github.com/repos/rclone/rclone/releases/latest"); err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			var result struct {
				TagName string `json:"tag_name"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
				return result.TagName
			}
		}
	}

	// Try 3: HTML Scrape of github.com/rclone/rclone/releases
	if resp, err := client.Get("https://github.com/rclone/rclone/releases"); err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			if body, err := io.ReadAll(io.LimitReader(resp.Body, 100*1024)); err == nil { // Read up to 100KB only
				htmlContent := string(body)
				idx := strings.Index(htmlContent, "/rclone/rclone/releases/tag/")
				if idx != -1 {
					sub := htmlContent[idx+len("/rclone/rclone/releases/tag/"):]
					end := strings.IndexAny(sub, `/"' >`)
					if end != -1 {
						tag := sub[:end]
						if strings.HasPrefix(tag, "v") {
							return tag
						}
					}
				}
			}
		}
	}

	return "v1.74.3" // Fallback to stable recent version
}

func downloadWithFallback(zipName string, osType string, archType string) ([]byte, error) {
	url := fmt.Sprintf("https://downloads.rclone.org/%s", zipName)
	setDownloadStatus(fmt.Sprintf("正在从 rclone.org 官方下载 %s...", zipName))

	resp, err := http.Get(url)
	var bodyBytes []byte
	var downloadErr error

	if err == nil && resp.StatusCode == http.StatusOK {
		setDownloadStatus("正在将 Zip 写入内存缓存...")
		buf := new(bytes.Buffer)
		_, downloadErr = io.Copy(buf, resp.Body)
		resp.Body.Close()
		if downloadErr == nil {
			bodyBytes = buf.Bytes()
		}
	} else {
		if err != nil {
			downloadErr = err
		} else {
			downloadErr = fmt.Errorf("HTTP 状态码异常: %d", resp.StatusCode)
		}
	}

	// If official download failed, try Github releases via multiple mirror proxies
	if downloadErr != nil {
		setDownloadStatus(fmt.Sprintf("官方源下载失败 (%v)，正在尝试通过 GitHub 镜像节点重试...", downloadErr))
		tag := getLatestGithubVersion()
		
		// Map zipName (rclone-current-xxx.zip) to rclone-vX.Y.Z-xxx.zip
		gitZipName := strings.Replace(zipName, "current", tag, 1)
		
		// List of reliable GitHub mirror nodes in China
		mirrors := []string{
			"https://ghproxy.cn/https://github.com/rclone/rclone/releases/download/%s/%s",
			"https://ghproxy.net/https://github.com/rclone/rclone/releases/download/%s/%s",
			"https://gh.ddlc.top/https://github.com/rclone/rclone/releases/download/%s/%s",
			"https://mirror.ghproxy.com/https://github.com/rclone/rclone/releases/download/%s/%s",
			"https://github.com/rclone/rclone/releases/download/%s/%s",
		}

		var lastErr error
		for i, mirrorPattern := range mirrors {
			mirrorUrl := fmt.Sprintf(mirrorPattern, tag, gitZipName)
			setDownloadStatus(fmt.Sprintf("正在使用镜像源 %d/%d 下载 %s...", i+1, len(mirrors), gitZipName))

			resp, err = http.Get(mirrorUrl)
			if err != nil {
				lastErr = fmt.Errorf("连接镜像失败: %v", err)
				continue
			}

			if resp.StatusCode != http.StatusOK {
				resp.Body.Close()
				lastErr = fmt.Errorf("镜像源返回状态码异常: %d", resp.StatusCode)
				continue
			}

			setDownloadStatus("正在将镜像 Zip 写入内存缓存...")
			buf := new(bytes.Buffer)
			_, err = io.Copy(buf, resp.Body)
			resp.Body.Close()
			if err != nil {
				lastErr = fmt.Errorf("读取镜像 Zip 数据流失败: %v", err)
				continue
			}

			bodyBytes = buf.Bytes()
			lastErr = nil
			break // Success
		}

		if lastErr != nil {
			return nil, fmt.Errorf("所有官方源与 GitHub 镜像源均下载失败，最后一次错误: %v", lastErr)
		}
	}

	return bodyBytes, nil
}
