import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import RootNavigator from './src/navigation';
import { ConfigProvider } from './src/config';
import { ToastHost } from './src/toast';
import { colors } from './src/theme';

export default function App() {
  return (
    <SQLiteProvider databaseName="itempanel.db" assetSource={{ assetId: require('./assets/itempanel.db') }}>
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
