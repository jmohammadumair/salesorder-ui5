const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, 'dist');
const zipPath = path.join(__dirname, 'dist', 'salesorder.zip');

// Ensure dist folder exists
if (!fs.existsSync(distDir)) {
    console.error('Error: dist folder does not exist. Run "npm run build" first.');
    process.exit(1);
}

// Remove existing zip if it exists
if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
}

console.log('Packaging build output into salesorder.zip...');

try {
    if (process.platform === 'win32') {
        // Windows PowerShell (native, no extra tools required)
        // We use -Path dist\* to include contents, and we exclude any existing zip
        execSync(`powershell -Command "Compress-Archive -Path dist\\* -DestinationPath dist\\salesorder.zip -Force"`, { stdio: 'inherit' });
    } else {
        // Linux/macOS (using standard zip command)
        execSync(`cd dist && zip -r salesorder.zip . -x "salesorder.zip" && cd ..`, { stdio: 'inherit' });
    }
    console.log('Successfully created dist/salesorder.zip for BTP deployment!');
} catch (error) {
    console.error('Failed to create zip archive:', error);
    process.exit(1);
}
