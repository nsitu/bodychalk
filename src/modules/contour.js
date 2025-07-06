export class ContourTracer {
    constructor() {
        this.threshold = 0.5;
    }

    extractContours(segmentation) {
        // Minimalist mode - reduced logging
        if (Math.random() < 0.05) { // Only log occasionally
            console.log('Processing segmentation...');
        }

        // Handle different segmentation formats
        let width, height, maskData;

        if (segmentation.width && segmentation.height && segmentation.data) {
            // Our custom format from BlazePose or TensorFlow.js BodyPix
            width = segmentation.width;
            height = segmentation.height;
            maskData = segmentation.data;
        } else {
            console.error('Unknown segmentation format:', segmentation);
            return [];
        }


        // Create a binary mask and check for person pixels
        const mask = new Array(width * height);
        let personPixelCount = 0;
        let backgroundPixelCount = 0;
        let otherValues = new Set();

        for (let i = 0; i < maskData.length; i++) {
            const value = maskData[i];
            otherValues.add(value);

            // Handle different mask formats:
            // - Binary masks: 0 for background, 1 for person
            // - Probability masks: 0.0-1.0 range
            if (value === 1) {
                mask[i] = 1;
                personPixelCount++;
            } else if (value === 0) {
                mask[i] = 0;
                backgroundPixelCount++;
            } else {
                // Some other value - treat anything > 0.5 as person
                mask[i] = value > 0.5 ? 1 : 0;
                if (mask[i] === 1) personPixelCount++;
                else backgroundPixelCount++;
            }
        }


        if (personPixelCount === 0) {
            return [];
        }

        // Find contours using edge detection
        const contours = this.findContours(mask, width, height);

        // Filter and simplify contours
        const filteredContours = contours
            .filter(contour => contour.length > 10) // Remove small contours
            .map(contour => this.simplifyContour(contour, 2)); // Simplify paths

        return filteredContours;
    }

    findContours(mask, width, height) {
        const contours = [];
        const visited = new Array(width * height).fill(false);

        // Moore neighborhood tracing
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const index = y * width + x;

                if (mask[index] === 1 && !visited[index]) {
                    // Check if this is a boundary pixel
                    if (this.isBoundaryPixel(mask, width, height, x, y)) {
                        const contour = this.traceContour(mask, width, height, x, y, visited);
                        if (contour.length > 10) {
                            contours.push(contour);
                        }
                    }
                }
            }
        }

        return contours;
    }

    isBoundaryPixel(mask, width, height, x, y) {
        const index = y * width + x;
        if (mask[index] === 0) return false;

        // Check 8-connected neighbors
        const neighbors = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        for (const [dx, dy] of neighbors) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const neighborIndex = ny * width + nx;
                if (mask[neighborIndex] === 0) {
                    return true; // Found a background neighbor
                }
            }
        }

        return false;
    }

    traceContour(mask, width, height, startX, startY, visited) {
        const contour = [];
        const directions = [
            [1, 0], [1, 1], [0, 1], [-1, 1],
            [-1, 0], [-1, -1], [0, -1], [1, -1]
        ];

        let x = startX;
        let y = startY;
        let dir = 0;
        let steps = 0;
        const maxSteps = 5000;

        do {
            const index = y * width + x;
            visited[index] = true;
            contour.push([x, y]);

            // Find next boundary pixel
            let found = false;
            for (let i = 0; i < 8; i++) {
                const newDir = (dir + i) % 8;
                const newX = x + directions[newDir][0];
                const newY = y + directions[newDir][1];

                if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
                    const newIndex = newY * width + newX;
                    if (mask[newIndex] === 1 && this.isBoundaryPixel(mask, width, height, newX, newY)) {
                        x = newX;
                        y = newY;
                        dir = (newDir + 6) % 8; // Turn left
                        found = true;
                        break;
                    }
                }
            }

            if (!found) break;
            steps++;

        } while (!(x === startX && y === startY) && steps < maxSteps);

        return contour;
    }

    simplifyContour(contour, tolerance = 1) {
        if (contour.length <= 2) return contour;

        // Douglas-Peucker algorithm for path simplification
        const simplified = [];

        const simplifyRecursive = (points, start, end, tolerance) => {
            if (end - start <= 1) return;

            let maxDistance = 0;
            let maxIndex = start;

            for (let i = start + 1; i < end; i++) {
                const distance = this.perpendicularDistance(
                    points[i],
                    points[start],
                    points[end]
                );

                if (distance > maxDistance) {
                    maxDistance = distance;
                    maxIndex = i;
                }
            }

            if (maxDistance > tolerance) {
                simplifyRecursive(points, start, maxIndex, tolerance);
                simplified.push(points[maxIndex]);
                simplifyRecursive(points, maxIndex, end, tolerance);
            }
        };

        simplified.push(contour[0]);
        simplifyRecursive(contour, 0, contour.length - 1, tolerance);
        simplified.push(contour[contour.length - 1]);

        return simplified;
    }

    perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd[0] - lineStart[0];
        const dy = lineEnd[1] - lineStart[1];

        if (dx === 0 && dy === 0) {
            return Math.sqrt(
                Math.pow(point[0] - lineStart[0], 2) +
                Math.pow(point[1] - lineStart[1], 2)
            );
        }

        const t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (dx * dx + dy * dy);

        if (t < 0) {
            return Math.sqrt(
                Math.pow(point[0] - lineStart[0], 2) +
                Math.pow(point[1] - lineStart[1], 2)
            );
        } else if (t > 1) {
            return Math.sqrt(
                Math.pow(point[0] - lineEnd[0], 2) +
                Math.pow(point[1] - lineEnd[1], 2)
            );
        }

        const projX = lineStart[0] + t * dx;
        const projY = lineStart[1] + t * dy;

        return Math.sqrt(
            Math.pow(point[0] - projX, 2) +
            Math.pow(point[1] - projY, 2)
        );
    }

    contoursToSVGPath(contours) {
        if (!contours || contours.length === 0) {
            return '';
        }

        let pathData = '';

        contours.forEach((contour, index) => {
            if (contour.length > 0) {
                pathData += `M ${contour[0][0]} ${contour[0][1]} `;

                for (let i = 1; i < contour.length; i++) {
                    pathData += `L ${contour[i][0]} ${contour[i][1]} `;
                }

                pathData += 'Z ';
            }
        });

        return pathData;
    }
}
