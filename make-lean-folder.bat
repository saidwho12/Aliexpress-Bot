mkdir build
robocopy .\\static build\\static /S /MIR
robocopy . .\\build index.html manifest.json