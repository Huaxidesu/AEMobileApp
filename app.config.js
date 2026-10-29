module.exports = {
  "expo": {
    "name": "AEMobile",
    "slug": "AEMobile",
    "version": "3.0.2",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "splash": {
      "resizeMode": "contain",
      "backgroundColor": "#0B0E14"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "dev.youtiao.aemonitor",
      "buildNumber": "6"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff",
      },
      "package": "dev.youtiao.aemonitor",
      "versionCode": 32
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "extra": {
      "eas": {
        "projectId": "592a287e-bcc2-4ace-b3fc-efe1f73ec693"
      }
    },
    "plugins": [[
      "expo-build-properties",
      {
        "android": {
          "usesCleartextTraffic": true
        }
      }
    ]]
  }
}