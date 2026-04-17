#!/usr/bin/env python3
"""
HeadCounter - Webcam Capture Application

This application captures photos from a webcam at configurable intervals
and can run custom commands on the saved images.
"""

import sys
import os
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                            QHBoxLayout, QLabel, QPushButton, QSpinBox, 
                            QLineEdit, QFileDialog, QComboBox, QCheckBox)
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QPixmap, QImage
from webcam_capture import WebcamCapture

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        
        self.setWindowTitle("HeadCounter - Webcam Capture")
        self.setMinimumSize(800, 600)
        
        # Initialize webcam capture
        self.webcam = WebcamCapture()
        
        # Create central widget and layout
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        
        # Create webcam preview area
        self.preview_label = QLabel("Webcam Preview")
        self.preview_label.setAlignment(Qt.AlignCenter)
        self.preview_label.setMinimumHeight(300)
        self.preview_label.setStyleSheet("border: 1px solid #ccc;")
        main_layout.addWidget(self.preview_label)
        
        # Create controls
        controls_layout = QHBoxLayout()
        
        # Left side controls
        left_controls = QVBoxLayout()
        
        # Camera selection
        camera_layout = QHBoxLayout()
        camera_layout.addWidget(QLabel("Camera:"))
        self.camera_combo = QComboBox()
        self.refresh_camera_list()
        camera_layout.addWidget(self.camera_combo)
        refresh_btn = QPushButton("Refresh")
        refresh_btn.clicked.connect(self.refresh_camera_list)
        camera_layout.addWidget(refresh_btn)
        left_controls.addLayout(camera_layout)
        
        # Interval settings
        interval_layout = QHBoxLayout()
        interval_layout.addWidget(QLabel("Capture Interval (seconds):"))
        self.interval_spinbox = QSpinBox()
        self.interval_spinbox.setRange(1, 3600)
        self.interval_spinbox.setValue(60)
        interval_layout.addWidget(self.interval_spinbox)
        left_controls.addLayout(interval_layout)
        
        # Resolution settings
        resolution_layout = QHBoxLayout()
        resolution_layout.addWidget(QLabel("Camera Resolution:"))
        self.resolution_combo = QComboBox()
        self.resolution_combo.addItems(["Low (320x240)", "Medium (640x480)", "High (1280x720)"])
        self.resolution_combo.setCurrentIndex(1)  # Default to medium
        self.resolution_combo.currentIndexChanged.connect(self.change_resolution)
        resolution_layout.addWidget(self.resolution_combo)
        left_controls.addLayout(resolution_layout)
        
        # Save directory
        save_dir_layout = QHBoxLayout()
        save_dir_layout.addWidget(QLabel("Save Directory:"))
        self.save_dir_edit = QLineEdit(os.path.abspath("../captured_images"))
        save_dir_layout.addWidget(self.save_dir_edit)
        browse_btn = QPushButton("Browse")
        browse_btn.clicked.connect(self.browse_save_directory)
        save_dir_layout.addWidget(browse_btn)
        left_controls.addLayout(save_dir_layout)
        
        controls_layout.addLayout(left_controls)
        
        # Right side controls
        right_controls = QVBoxLayout()
        
        # Command to run
        command_layout = QHBoxLayout()
        command_layout.addWidget(QLabel("Command to run on each image:"))
        right_controls.addLayout(command_layout)
        
        self.command_edit = QLineEdit()
        self.command_edit.setPlaceholderText("e.g., analyze_image.py {image_path}")
        right_controls.addWidget(self.command_edit)
        
        command_help = QLabel("Use {image_path} as a placeholder for the captured image path")
        command_help.setStyleSheet("color: gray; font-size: 10px;")
        right_controls.addWidget(command_help)
        
        # Enable/disable command execution
        self.run_command_checkbox = QCheckBox("Run command after capture")
        right_controls.addWidget(self.run_command_checkbox)
        
        # Performance settings
        self.high_quality_preview = QCheckBox("High quality preview")
        self.high_quality_preview.setChecked(False)
        self.high_quality_preview.setToolTip("Enable for better preview quality, disable for better UI responsiveness")
        self.high_quality_preview.stateChanged.connect(self.toggle_preview_quality)
        right_controls.addWidget(self.high_quality_preview)
        
        controls_layout.addLayout(right_controls)
        main_layout.addLayout(controls_layout)
        
        # Action buttons
        buttons_layout = QHBoxLayout()
        
        self.start_stop_btn = QPushButton("Start Capture")
        self.start_stop_btn.clicked.connect(self.toggle_capture)
        buttons_layout.addWidget(self.start_stop_btn)
        
        self.capture_now_btn = QPushButton("Capture Now")
        self.capture_now_btn.clicked.connect(self.capture_now)
        buttons_layout.addWidget(self.capture_now_btn)
        
        main_layout.addLayout(buttons_layout)
        
        # Status bar
        self.statusBar().showMessage("Ready")
        
        # Timer for updating preview
        self.preview_timer = QTimer()
        self.preview_timer.timeout.connect(self.update_preview)
        
        # Timer for capturing images
        self.capture_timer = QTimer()
        self.capture_timer.timeout.connect(self.capture_now)
        
        # Start webcam preview
        self.preview_timer.start(100)  # Update preview at 100ms intervals (10 fps) to reduce CPU usage
        
        # Capture state
        self.capturing = False
    
    def refresh_camera_list(self):
        """Refresh the list of available cameras"""
        current_camera = self.camera_combo.currentText()
        self.camera_combo.clear()
        
        # Get available cameras
        cameras = self.webcam.get_available_cameras()
        for i, camera_name in enumerate(cameras):
            self.camera_combo.addItem(f"Camera {i}: {camera_name}")
        
        # Try to restore previous selection
        index = self.camera_combo.findText(current_camera)
        if index >= 0:
            self.camera_combo.setCurrentIndex(index)
        
        # If we have cameras, select the first one and open it
        if self.camera_combo.count() > 0:
            camera_index = int(self.camera_combo.currentText().split(':')[0].replace('Camera ', ''))
            self.webcam.open_camera(camera_index)
    
    def update_preview(self):
        """Update the webcam preview"""
        # Only update preview if window is visible and not minimized
        if self.isMinimized() or not self.isVisible():
            return
            
        frame = self.webcam.get_frame()
        if frame is not None:
            height, width, channel = frame.shape
            bytes_per_line = 3 * width
            q_image = QImage(frame.data, width, height, bytes_per_line, QImage.Format_RGB888)
            # Use FastTransformation instead of SmoothTransformation for better performance
            self.preview_label.setPixmap(QPixmap.fromImage(q_image).scaled(
                self.preview_label.width(), self.preview_label.height(), 
                Qt.KeepAspectRatio, Qt.FastTransformation))
    
    def browse_save_directory(self):
        """Open a dialog to select the save directory"""
        directory = QFileDialog.getExistingDirectory(
            self, "Select Save Directory", self.save_dir_edit.text())
        if directory:
            self.save_dir_edit.setText(directory)
    
    def toggle_capture(self):
        """Start or stop the timed capture"""
        if not self.capturing:
            # Start capturing
            interval_ms = self.interval_spinbox.value() * 1000
            save_dir = self.save_dir_edit.text()
            
            # Ensure save directory exists
            if not os.path.exists(save_dir):
                os.makedirs(save_dir)
            
            # Configure webcam
            camera_index = int(self.camera_combo.currentText().split(':')[0].replace('Camera ', ''))
            
            # Get resolution based on selection
            resolution_index = self.resolution_combo.currentIndex()
            if resolution_index == 0:  # Low
                width, height = 320, 240
            elif resolution_index == 1:  # Medium
                width, height = 640, 480
            else:  # High
                width, height = 1280, 720
            
            self.webcam.open_camera(camera_index)
            self.webcam.set_resolution(camera_index, width, height)
            self.webcam.set_save_directory(save_dir)
            self.webcam.set_command(self.command_edit.text() if self.run_command_checkbox.isChecked() else None)
            
            # Start timer
            self.capture_timer.start(interval_ms)
            self.start_stop_btn.setText("Stop Capture")
            self.capturing = True
            self.statusBar().showMessage(f"Capturing every {self.interval_spinbox.value()} seconds")
        else:
            # Stop capturing
            self.capture_timer.stop()
            self.start_stop_btn.setText("Start Capture")
            self.capturing = False
            self.statusBar().showMessage("Capture stopped")
    
    def capture_now(self):
        """Capture an image immediately"""
        save_dir = self.save_dir_edit.text()
        
        # Ensure save directory exists
        if not os.path.exists(save_dir):
            os.makedirs(save_dir)
        
        # Configure webcam if not already capturing
        if not self.capturing:
            camera_index = int(self.camera_combo.currentText().split(':')[0].replace('Camera ', ''))
            
            # Get resolution based on selection
            resolution_index = self.resolution_combo.currentIndex()
            if resolution_index == 0:  # Low
                width, height = 320, 240
            elif resolution_index == 1:  # Medium
                width, height = 640, 480
            else:  # High
                width, height = 1280, 720
            
            self.webcam.open_camera(camera_index)
            self.webcam.set_resolution(camera_index, width, height)
            self.webcam.set_save_directory(save_dir)
            self.webcam.set_command(self.command_edit.text() if self.run_command_checkbox.isChecked() else None)
        
        # Capture image
        image_path = self.webcam.capture_image()
        if image_path:
            self.statusBar().showMessage(f"Image captured: {os.path.basename(image_path)}")
        else:
            self.statusBar().showMessage("Failed to capture image")
    
    def toggle_preview_quality(self):
        """Toggle between high quality and high performance preview"""
        # Adjust preview timer interval based on quality setting
        if self.high_quality_preview.isChecked():
            self.preview_timer.setInterval(50)  # 20 fps for higher quality
            self.statusBar().showMessage("High quality preview enabled", 2000)
        else:
            self.preview_timer.setInterval(100)  # 10 fps for better performance
            self.statusBar().showMessage("High performance mode enabled", 2000)
    
    def change_resolution(self):
        """Change the camera resolution"""
        if self.camera_combo.count() == 0:
            return
            
        camera_index = int(self.camera_combo.currentText().split(':')[0].replace('Camera ', ''))
        
        # Get resolution based on selection
        resolution_index = self.resolution_combo.currentIndex()
        if resolution_index == 0:  # Low
            width, height = 320, 240
        elif resolution_index == 1:  # Medium
            width, height = 640, 480
        else:  # High
            width, height = 1280, 720
        
        # Update camera resolution
        self.webcam.set_resolution(camera_index, width, height)
        self.statusBar().showMessage(f"Resolution changed to {width}x{height}", 2000)
    
    def closeEvent(self, event):
        """Clean up resources when closing the application"""
        self.preview_timer.stop()
        self.capture_timer.stop()
        self.webcam.release()
        super().closeEvent(event)


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()