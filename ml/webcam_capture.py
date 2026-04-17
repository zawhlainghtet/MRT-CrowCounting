#!/usr/bin/env python3
"""
WebcamCapture module for the HeadCounter application.

This module handles the webcam interaction, image capture, and running commands on captured images.
"""

import cv2
import os
import datetime
import subprocess
import threading
import time

class WebcamCapture:
    def __init__(self):
        self.camera = None
        self.camera_index = 0
        self.save_directory = "../captured_images"
        self.command = None
        self.command_running = False
        self.last_frame = None
        self.last_frame_time = 0
        self.frame_buffer_ms = 50  # Only get a new frame every 50ms
    
    def get_available_cameras(self):
        """Get a list of available camera devices"""
        camera_names = []
        max_cameras_to_check = 5  # Check up to 5 cameras
        
        for i in range(max_cameras_to_check):
            # Use a shorter timeout for faster detection
            temp_camera = cv2.VideoCapture(i)
            if temp_camera.isOpened():
                # Just check if camera is opened, don't try to read a frame
                # This is much faster but less reliable
                camera_names.append(f"Device {i}")
                temp_camera.release()
            # Reduced sleep time for better responsiveness
            time.sleep(0.05)
        
        return camera_names
    
    def open_camera(self, camera_index):
        """Open the specified camera"""
        # If we already have a camera open and it's the same index, do nothing
        if self.camera is not None and self.camera_index == camera_index and self.camera.isOpened():
            return True
        
        # Release current camera if open
        self.release()
        
        # Reset frame buffer
        self.last_frame = None
        self.last_frame_time = 0
        
        # Open new camera
        self.camera_index = camera_index
        self.camera = cv2.VideoCapture(camera_index)
        
        # Set camera properties - use 640x480 for better performance
        if self.camera.isOpened():
            self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            # Set buffer size to 1 for lower latency
            self.camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return True
        
        return False
        
    def set_resolution(self, camera_index, width, height):
        """Set the camera resolution"""
        # If camera is already open with the same index
        if self.camera is not None and self.camera.isOpened() and self.camera_index == camera_index:
            # Set new resolution
            self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            
            # Reset frame buffer after changing resolution
            self.last_frame = None
            self.last_frame_time = 0
            return True
        
        # If camera is not open or different index, open it first
        if self.open_camera(camera_index):
            self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            return True
            
        return False
    
    def get_frame(self):
        """Get a frame from the camera with buffering for better performance"""
        if self.camera is None or not self.camera.isOpened():
            return None
        
        # Check if we should use the buffered frame
        current_time = int(time.time() * 1000)
        if self.last_frame is not None and current_time - self.last_frame_time < self.frame_buffer_ms:
            return self.last_frame
        
        # Get a new frame
        ret, frame = self.camera.read()
        if ret:
            # Convert BGR to RGB for Qt
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            self.last_frame = rgb_frame
            self.last_frame_time = current_time
            return rgb_frame
        
        return None
    
    def set_save_directory(self, directory):
        """Set the directory where images will be saved"""
        self.save_directory = directory
        
        # Ensure directory exists
        if not os.path.exists(directory):
            os.makedirs(directory)
    
    def set_command(self, command):
        """Set the command to run on each captured image"""
        self.command = command
    
    def capture_image(self):
        """Capture an image and save it with timestamp"""
        if self.camera is None or not self.camera.isOpened():
            return None
        
        # Capture frame
        ret, frame = self.camera.read()
        if not ret:
            return None
        
        # Generate filename with timestamp
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"capture_{timestamp}.jpg"
        filepath = os.path.join(self.save_directory, filename)
        
        # Save image
        cv2.imwrite(filepath, frame)
        
        # Run command on image if specified
        if self.command:
            self._run_command_on_image(filepath)
        
        return filepath
    
    def _run_command_on_image(self, image_path):
        """Run the specified command on the captured image"""
        if not self.command or self.command_running:
            return
        
        # Replace placeholder with actual image path
        command = self.command.replace("{image_path}", image_path)
        
        # Run command in a separate thread to avoid blocking the UI
        def run_command():
            self.command_running = True
            try:
                subprocess.run(command, shell=True, check=True)
            except subprocess.SubprocessError as e:
                print(f"Error running command: {e}")
            finally:
                self.command_running = False
        
        threading.Thread(target=run_command).start()
    
    def release(self):
        """Release the camera resources"""
        if self.camera is not None:
            self.camera.release()
            self.camera = None