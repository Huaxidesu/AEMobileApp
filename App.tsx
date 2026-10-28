import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import RootNavigator from './src/navigation';
import SetupScreen from './src/screens/SetupScreen';
import { ConfigProvider, useConfig } from './src/config';
import { ToastHost } from './src/toast';
import { colors, spacing } from './src/theme';
import { getAuxSignature, resolveActiveDb, subscribeActiveDb } from './src/iconpack';
import { clearDbCaches } from './src/db';
import { attachAux } from './src/dbs';

export default function App() {
  // 图标库可能被在线更新替换过：数据库名存 SecureStore，切换后靠 key 重新挂载 Provider
  /** undefined = 还在判断；null = 没有任何物品库（要走首次配置） */
  const [dbName, setDbName] = useState<string | null | undefined>(undefined);
  /** 辅助库（流体/源质）换过也要重挂 Provider，否则 ATTACH 还是旧的 */
  const [auxSig, setAuxSig] = useState('');
  /** 首帧 UI 出来之前一直盖着启动页，避免 SQLite 打开/导入期间露出空白 */
  const [booted, setBooted] = useState(false);
  /**
   * 图标字体必须显式预加载。
   * @expo/vector-icons 是在**第一次渲染某个图标时**才去加载 ttf 的，
   * 所以底栏会出现「先有文字、几百毫秒后图标才冒出来」的闪烁。
   */
  const [fontsReady, fontError] = useFonts(Ionicons.font);
  /** 辅助库（流体/源质）由 resolveActiveDb 里的内置包落地负责，这里只等它就绪 */
  const [auxReady, setAuxReady] = useState(false);

  const refresh = useCallback(() => {
    resolveActiveDb()
      .then((name) => {
        clearDbCaches();
        setDbName(name);
        setAuxSig(getAuxSignature());
        setAuxReady(true);
        // 没有图标库时不进主界面，启动页得在这里关掉（AppShell 不会挂载）
        if (!name) setBooted(true);
      })
      .catch(() => setDbName(null));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeActiveDb(refresh);
  }, [refresh]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        {dbName === null ? (
          // 没有图标库：先让用户导入配置包 / 填图标源，下载完再进主界面
          <ConfigProvider>
            <SetupScreen onDone={refresh} />
          </ConfigProvider>
        ) : dbName && auxReady ? (
          <SQLiteProvider
            key={`${dbName}|${auxSig}`}
            databaseName={dbName}
            onInit={attachAux}
            onError={(e) => console.warn('[db] open failed', e)}
          >
            <ConfigProvider>
              <AppShell onReady={() => setBooted(true)} />
            </ConfigProvider>
          </SQLiteProvider>
        ) : null}
        {booted && (fontsReady || fontError) ? null : <BootOverlay />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell({ onReady }: { onReady: () => void }) {
  const { ready } = useConfig();
  useEffect(() => {
    if (ready) onReady();
  }, [ready, onReady]);
  return (
    <>
      {/* 状态栏不透明：内容永远不会滚到状态栏底下；新版 Android 强制边到边时由各屏的 insets 兜底 */}
      <StatusBar style="light" translucent={false} backgroundColor={colors.bg} />
      <RootNavigator />
      <ToastHost />
    </>
  );
}

/** 启动页：深色底 + 字标 + 转圈，与原生 splash 同色，衔接起来像一次连续启动 */
function BootOverlay() {
  return (
    <View style={styles.boot} pointerEvents="none">
      <Text style={styles.bootTitle}>AEMobile</Text>
      <Text style={styles.bootSub}>GTNH AE 网络监控</Text>
      <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.s }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  boot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bootTitle: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  bootSub: { color: colors.textFaint, fontSize: 11, letterSpacing: 1 },
});
