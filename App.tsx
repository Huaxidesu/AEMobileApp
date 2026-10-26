import { useCallback, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import RootNavigator from './src/navigation';
import { ConfigProvider } from './src/config';
import { ToastHost } from './src/toast';
import { colors } from './src/theme';
import { BUILTIN_DB, resolveActiveDb, subscribeActiveDb } from './src/iconpack';
import { clearDbCaches } from './src/db';

export default function App() {
  // 图标库可能被在线更新替换过：数据库名存 SecureStore，切换后靠 key 重新挂载 Provider
  const [dbName, setDbName] = useState<string | null>(null);
  const refresh = useCallback(() => {
    resolveActiveDb()
      .then((name) => {
        clearDbCaches();
        setDbName(name);
      })
      .catch(() => setDbName(BUILTIN_DB));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeActiveDb(refresh);
  }, [refresh]);

  if (!dbName) return <GestureHandlerRootView style={styles.container} />;

  return (
    <SQLiteProvider
      key={dbName}
      databaseName={dbName}
      assetSource={dbName === BUILTIN_DB ? { assetId: require('./assets/itempanel.db') } : undefined}
    >
      <ConfigProvider>
        <GestureHandlerRootView style={styles.container}>
          <StatusBar style="light" />
          <RootNavigator />
          <ToastHost />
        </GestureHandlerRootView>
      </ConfigProvider>
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
});
