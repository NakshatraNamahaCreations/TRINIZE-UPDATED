const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Windows only: point Gradle at a newer SDK CMake. The default 3.22.1 ships ninja 1.10,
 * which can't handle paths over 260 chars — reanimated's C++ build exceeds that.
 * Ninja 1.12+ (CMake 3.31) respects LongPathsEnabled. No-op if that CMake isn't installed.
 */
module.exports = function withNewerCmake(config, { version = '3.31.6' } = {}) {
  return withDangerousMod(config, ['android', async cfg => {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    const dir = sdk && path.join(sdk, 'cmake', version);
    if (process.platform !== 'win32' || !dir || !fs.existsSync(dir)) return cfg;

    const file = path.join(cfg.modRequest.platformProjectRoot, 'local.properties');
    const lines = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('cmake.dir='))
      : [];
    lines.push('cmake.dir=' + dir.replace(/\\/g, '/')); // backslashes are escapes in .properties
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return cfg;
  }]);
};
