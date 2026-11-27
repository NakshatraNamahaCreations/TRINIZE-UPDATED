const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Sign release builds with the Trinize upload key instead of the shared debug key (QA B-01).
 *
 * The key and its passwords never live in this repo. They are read at build time from a
 * .properties file outside git:
 *
 *   storeFile=D:/path/to/trinize-upload.jks
 *   storePassword=...
 *   keyAlias=trinize-upload
 *   keyPassword=...
 *
 * Path: the TRINIZE_SIGNING env var if set, else the `propsFile` option (relative to the app
 * root). A release build fails if the file is missing — it never quietly falls back to the
 * debug key. Debug builds are unaffected.
 */
module.exports = function withReleaseSigning(config, { propsFile = '../../TRINIZE-keys/signing.properties' } = {}) {
  return withAppBuildGradle(config, cfg => {
    let g = cfg.modResults.contents;
    if (g.includes('trinizeSigning')) return cfg;
    const fallback = JSON.stringify(propsFile.replace(/\\/g, '/'));

    const block = `
    // Trinize release key — read from outside the repo (plugins/withReleaseSigning.js)
    def trinizeSigningFile = file(System.getenv('TRINIZE_SIGNING') ?: new File(rootProject.projectDir.parentFile, ${fallback}).path)
    def trinizeSigning = new Properties()
    if (trinizeSigningFile.exists()) trinizeSigningFile.withInputStream { trinizeSigning.load(it) }
    gradle.taskGraph.whenReady { graph ->
        if (graph.allTasks.any { it.name.toLowerCase().contains('release') } && !trinizeSigningFile.exists()) {
            throw new GradleException("Release signing file not found: \${trinizeSigningFile}. Set TRINIZE_SIGNING to the signing.properties path — see plugins/withReleaseSigning.js.")
        }
    }
    signingConfigs {`;
    g = g.replace(/\n    signingConfigs \{/, block);
    g = g.replace(/(\n        debug \{\n            storeFile file\('debug\.keystore'\)[\s\S]*?\n        \})/,
      `$1
        release {
            if (trinizeSigningFile.exists()) {
                storeFile file(trinizeSigning['storeFile'])
                storePassword trinizeSigning['storePassword']
                keyAlias trinizeSigning['keyAlias']
                keyPassword trinizeSigning['keyPassword']
            }
        }`);
    g = g.replace(/(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
    if (!g.includes('signingConfig signingConfigs.release') || !g.includes('trinizeSigning[\'storeFile\']')) {
      throw new Error('withReleaseSigning: android/app/build.gradle did not have the expected shape — update the plugin.');
    }
    cfg.modResults.contents = g;
    return cfg;
  });
};
