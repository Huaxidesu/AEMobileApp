// 应用元信息：原生版本号优先（Gradle 的 versionName），expoConfig 仅在开发态作为后备；
// 仓库地址集中在此，换仓库只改这一处
import Constants from 'expo-constants';

export const APP_VERSION = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '0.0.0';

/** 手机端仓库 */
export const REPO_APP = 'https://github.com/Huaxidesu/AEMobileApp';

/** 服务端 mod 仓库 */
export const REPO_MOD = 'https://github.com/Huaxidesu/AEMobile';
