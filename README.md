# bodychalk
Trace the outline of a body via webcam segmentation and output as SVG path.

## About
Stand in front of your camera, and the app will automatically trace the outline of your body, creating a silhouette that you can download and use in your creative projects.

## App process
Here's what the app does:
- Captures video frames from the webcam
- Analyzes frames via [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker), a Google AI model trained to recognize humans
- Creates a "segmentation mask" from each frame, following the body's contour.
- Traces around the edges of the mask to form a series of connected points 
- Smooths the traced points into a flowing path
- Generates an SVG file for output
 

## Community
The app is being piloted with input from [Arts For All](https://artsforall.co/). You can check out the growing gallery of shared silhouettes on the [bodychalk community page](https://artsforall.co/bodychalk).