import './modules/polyfillMSTP.js';
import './style.css'

// main.js
import { loadIcons } from './modules/iconLoader.js';
const iconNames = ['cameraswitch', 'download', 'colors', 'share'];
loadIcons(iconNames);

import { startAppBtn, welcomeScreen, app, loadingSpinner, cameraToggle, randomColor, bodyPath, svgElement, shareFile } from './modules/domElements.js';
import { CameraManager } from './modules/camera.js';
import { PoseProcessor } from './modules/poseProcessor.js';
import { DownloadManager } from './modules/download.js';
import { ShareManager } from './modules/share.js';

let cameraManager = null;
let poseProcessor = null;
let downloadManager = null;
let shareManager = null;
let processingLoop = null;

// Start preloading immediately when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize both managers
        cameraManager = new CameraManager();
        poseProcessor = new PoseProcessor();

        console.log('Starting background model preload...');
        await poseProcessor.preloadModel();
        console.log('Model preload completed!');

        loadingSpinner.style.display = 'none';
        startAppBtn.style.display = 'inline-block';
        // Enable the start button once model is loaded
        startAppBtn.textContent = 'Start';
        startAppBtn.disabled = false;

    } catch (error) {
        console.error('Background model preload failed:', error);

        // Show error state
        startAppBtn.textContent = 'Model loading failed - Click to retry';
        startAppBtn.disabled = false;

        // Allow retry by clicking the button
        startAppBtn.addEventListener('click', () => {
            location.reload(); // Simple retry by reloading the page
        }, { once: true });
    }
});

// Initialize app after user clicks start button
startAppBtn.addEventListener('click', async () => {
    // Only proceed if the model is loaded
    if (!cameraManager || !poseProcessor || startAppBtn.textContent !== 'Start') {
        return;
    }

    startAppBtn.textContent = 'Starting camera...';
    startAppBtn.disabled = true;

    try {
        // Initialize camera
        const cameraInfo = await cameraManager.initialize();

        // Initialize pose processor with camera dimensions
        poseProcessor.setDimensions(cameraInfo.width, cameraInfo.height);
        await poseProcessor.initializeBlazePose();

        // Initialize download manager
        downloadManager = new DownloadManager(cameraManager);

        // Initialize share manager
        shareManager = new ShareManager(cameraManager);

        // Set up camera toggle if multiple cameras available
        if (cameraManager.hasMultipleCamerasAvailable()) {
            cameraToggle.addEventListener('click', toggleCamera);
        }

        // Set up random color button
        randomColor.addEventListener('click', changeToRandomColor);

        // Start processing loop
        startProcessingLoop();

        // Hide welcome screen and show app
        welcomeScreen.style.display = 'none';
        app.style.display = 'block';

        console.log('Application started successfully');

    } catch (error) {
        console.error('Error starting application:', error);

        // Show more specific error messages
        let errorMessage = 'Failed to start camera. Try again?';
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Camera access denied. Please allow camera access and try again.';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No camera found. Please connect a camera and try again.';
        } else if (error.message.includes('MediaPipe')) {
            errorMessage = 'Failed to load AI model. Please check your internet connection.';
        }

        startAppBtn.textContent = errorMessage;
        startAppBtn.disabled = false;
    }
});

// Processing loop to handle camera frames
async function startProcessingLoop() {
    try {
        // Get the frame stream from camera
        const frameStream = cameraManager.getFrameStream();

        // Process frames
        for await (const frame of frameStream) {
            // Process each frame with pose processor
            await poseProcessor.processFrame(frame);
        }
    } catch (error) {
        console.error('Processing loop error:', error);
    }
}

// Camera toggle functionality
async function toggleCamera() {
    try {
        cameraToggle.disabled = true;

        // Stop current processing
        if (processingLoop) {
            cameraManager.stop();
        }

        // Toggle camera
        const newCameraInfo = await cameraManager.toggleCamera();

        // Update pose processor with new dimensions
        poseProcessor.setDimensions(newCameraInfo.width, newCameraInfo.height);

        // Restart processing loop
        startProcessingLoop();

    } catch (error) {
        console.error('Camera toggle failed:', error);
    } finally {
        cameraToggle.disabled = false;
    }
}

// Generate random color
function getRandomColor() {
    const colors = [
        '#ff0000', // red
        '#00ff00', // green
        '#0000ff', // blue
        '#ffff00', // yellow
        '#ff00ff', // magenta
        '#00ffff', // cyan
        '#ff8000', // orange
        '#8000ff', // purple
        '#ff0080', // pink
        '#80ff00', // lime
        '#0080ff', // light blue
        '#ff8080', // light red
        '#80ff80', // light green
        '#8080ff', // light blue
        '#ffff80', // light yellow
        '#ff80ff', // light magenta
        '#80ffff', // light cyan
        '#ffffff', // white
    ];

    return colors[Math.floor(Math.random() * colors.length)];
}

// Random color functionality
function changeToRandomColor() {
    const newColor = getRandomColor();
    svgElement.style.setProperty('--stroke-color', newColor);
    console.log(`Changed stroke color to: ${newColor}`);
}

// Event listener for random color button
randomColor.addEventListener('click', changeToRandomColor);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (cameraManager) {
        cameraManager.stop();
    }
    if (poseProcessor) {
        poseProcessor.cleanup();
    }
});