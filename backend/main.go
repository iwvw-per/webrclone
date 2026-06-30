package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

//go:embed all:dist
var frontendFS embed.FS

type AuthConfig struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

var (
	dataDir        = "."
	authConfig     AuthConfig
	authConfigLock sync.RWMutex
	authFilePath   = "auth.json"
)

// BasicAuth middleware to secure endpoints
func BasicAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Allow CORS preflight requests
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
			w.WriteHeader(http.StatusOK)
			return
		}

		authConfigLock.RLock()
		expectedUser := authConfig.Username
		expectedPass := authConfig.Password
		isInitialized := expectedUser != "" && expectedPass != ""
		authConfigLock.RUnlock()

		if !isInitialized {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("Uninitialized"))
			return
		}

		username, password, ok := r.BasicAuth()
		if !ok || username != expectedUser || password != expectedPass {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("Unauthorized"))
			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		next(w, r)
	}
}

func main() {
	// Parse flag and env
	dataDirFlag := flag.String("data", "", "Directory to store data (auth.json, tasks_db.json, rclone.conf, bin/)")
	flag.Parse()

	if envVal := os.Getenv("WEBRCLONE_DATA_DIR"); envVal != "" {
		dataDir = envVal
	}
	if *dataDirFlag != "" {
		dataDir = *dataDirFlag
	}

	// Make sure directories exist
	_ = os.MkdirAll(filepath.Join(dataDir, "bin"), 0755)

	// Initialize paths
	authFilePath = filepath.Join(dataDir, "auth.json")
	dbPath = filepath.Join(dataDir, "tasks_db.json")

	// Initialize tasks database
	InitTasks()

	// Load credentials from auth.json
	if data, err := os.ReadFile(authFilePath); err == nil {
		_ = json.Unmarshal(data, &authConfig)
	}

	// API routes
	http.HandleFunc("/api/auth/status", handleAuthStatus)
	http.HandleFunc("/api/auth/setup", handleAuthSetup)

	http.HandleFunc("/api/rclone/status", BasicAuth(handleRcloneStatus))
	http.HandleFunc("/api/rclone/download", BasicAuth(handleRcloneDownload))
	http.HandleFunc("/api/rclone/upload", BasicAuth(handleRcloneUpload))
	http.HandleFunc("/api/config/path", BasicAuth(handleConfigPath))
	http.HandleFunc("/api/config/raw", BasicAuth(handleConfigRaw))
	http.HandleFunc("/api/config/remotes", BasicAuth(handleConfigRemotes))
	http.HandleFunc("/api/tasks", BasicAuth(handleTasks))
	http.HandleFunc("/api/tasks/start", BasicAuth(handleTasksStart))
	http.HandleFunc("/api/tasks/stop", BasicAuth(handleTasksStop))

	// Frontend files serving
	var publicFS fs.FS
	sub, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		fmt.Printf("Error creating sub filesystem: %v\n", err)
		publicFS = os.DirFS("dist")
	} else {
		publicFS = sub
	}

	fileServer := http.FileServer(http.FS(publicFS))

	// SPA Router: serve frontend files, fall back to index.html for unknown routes
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// If requesting API, return 404 if not matched above
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte("API endpoint not found"))
			return
		}

		// Try to serve static file
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Check if file exists in the embed FS
		file, err := publicFS.Open(path)
		if err != nil {
			// Serve index.html for SPA router
			indexFile, err := publicFS.Open("index.html")
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("Static assets not found. Please compile frontend first."))
				return
			}
			defer indexFile.Close()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.Copy(w, indexFile)
			return
		}
		file.Close()

		fileServer.ServeHTTP(w, r)
	})

	port := "8080"
	fmt.Printf("WebRclone server starting on port %s...\n", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		fmt.Printf("Server failed: %v\n", err)
	}
}

// IO Copy helper
func ioCopy(w http.ResponseWriter, r fs.File) {
	_, _ = io.Copy(w, r)
}

// API Route Handlers

func handleRcloneStatus(w http.ResponseWriter, r *http.Request) {
	v, _ := CheckRcloneVersion()
	status := GetDownloadStatus()
	response := map[string]interface{}{
		"version":        v,
		"downloadStatus": status,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func handleRcloneDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	TriggerDownload()
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"triggered"}`))
}

func handleConfigPath(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		path := GetConfigPath()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"path": path})
	} else if r.Method == "POST" {
		var req struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		SetConfigPath(req.Path)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"saved"}`))
	} else {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleConfigRaw(w http.ResponseWriter, r *http.Request) {
	path := GetConfigPath()
	if r.Method == "GET" {
		content, err := GetRawConfig(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"content": content})
	} else if r.Method == "POST" {
		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := SaveRawConfig(path, req.Content); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"saved"}`))
	} else {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleConfigRemotes(w http.ResponseWriter, r *http.Request) {
	path := GetConfigPath()
	if r.Method == "GET" {
		remotes, err := ParseINI(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(remotes)
	} else if r.Method == "POST" {
		var req struct {
			Name   string            `json:"name"`
			Params map[string]string `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		remotes, err := ParseINI(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		remotes[req.Name] = req.Params
		if err := SerializeINI(path, remotes); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"saved"}`))
	} else if r.Method == "DELETE" {
		name := r.URL.Query().Get("name")
		if name == "" {
			http.Error(w, "name parameter required", http.StatusBadRequest)
			return
		}

		remotes, err := ParseINI(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		delete(remotes, name)
		if err := SerializeINI(path, remotes); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"deleted"}`))
	} else {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleTasks(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	w.Header().Set("Content-Type", "application/json")
	if id != "" {
		t, ok := GetTask(id)
		if !ok {
			http.Error(w, "task not found", http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(t)
	} else {
		list := GetTasks()
		json.NewEncoder(w).Encode(list)
	}
}

func handleTasksStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Command     string   `json:"command"`
		Source      string   `json:"source"`
		Destination string   `json:"destination"`
		Flags       []string `json:"flags"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	id, err := StartTask(req.Command, req.Source, req.Destination, req.Flags)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "started"})
}

func handleTasksStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id parameter required", http.StatusBadRequest)
		return
	}

	if err := StopTask(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"stopped"}`))
}

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	authConfigLock.RLock()
	initialized := authConfig.Username != "" && authConfig.Password != ""
	authConfigLock.RUnlock()

	json.NewEncoder(w).Encode(map[string]bool{"initialized": initialized})
}

func handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	authConfigLock.RLock()
	initialized := authConfig.Username != "" && authConfig.Password != ""
	authConfigLock.RUnlock()

	if initialized {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("Already initialized"))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}

	if req.Username == "" || req.Password == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("Username and password cannot be empty"))
		return
	}

	// Save auth config
	authConfigLock.Lock()
	authConfig.Username = req.Username
	authConfig.Password = req.Password

	data, err := json.Marshal(authConfig)
	if err != nil {
		authConfigLock.Unlock()
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	err = os.WriteFile(authFilePath, data, 0600)
	authConfigLock.Unlock()

	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Successfully initialized credentials"))
}

func handleRcloneUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// parse multipart file
	err := r.ParseMultipartForm(32 << 20) // limit 32MB
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}
	defer file.Close()

	destPath, err := GetRclonePath()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	// Write file to destPath
	tempPath := destPath + ".tmp"
	destFile, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, file)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	destFile.Close() // Close before rename

	// Replace target file
	if _, err := os.Stat(destPath); err == nil {
		_ = os.Remove(destPath)
	}

	err = os.Rename(tempPath, destPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	// Make sure execution permissions are set (vital on Linux/macOS)
	_ = os.Chmod(destPath, 0755)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Successfully uploaded Rclone binary"))
}
