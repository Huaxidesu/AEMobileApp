// 根导航：未配置 → 设置页；已配置 → 四 Tab 主界面
import React from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from './config';
import { colors } from './theme';
import ItemsScreen from './screens/ItemsScreen';
import ItemDetailScreen from './screens/ItemDetailScreen';
import PlanReviewScreen from './screens/PlanReviewScreen';
import CraftScreen from './screens/CraftScreen';
import MonitorScreen from './screens/MonitorScreen';
import SettingsScreen from './screens/SettingsScreen';
import ServerSettingsScreen from './screens/ServerSettingsScreen';
import IconPackScreen from './screens/IconPackScreen';
import CacheScreen from './screens/CacheScreen';
import AboutScreen from './screens/AboutScreen';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

/** 设置子页共用的原生导航头（暗色） */
const subHeader = (title: string) => ({
  headerShown: true,
  headerTitle: title,
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { color: colors.text, fontSize: 16, fontWeight: '700' as const },
  headerShadowVisible: false,
});

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Items: 'grid',
  Craft: 'construct',
  Monitor: 'pulse',
  Settings: 'settings',
};

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabel: ({ color }) => <Text style={{ color, fontSize: 10, fontWeight: '600' }}>{TAB_LABELS[route.name]}</Text>,
        tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name] ?? 'ellipse'} size={size - 2} color={color} />,
      })}
    >
      <Tabs.Screen name="Items" component={ItemsScreen} />
      <Tabs.Screen name="Craft" component={CraftScreen} />
      <Tabs.Screen name="Monitor" component={MonitorScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

const TAB_LABELS: Record<string, string> = {
  Items: '物品',
  Craft: '合成',
  Monitor: '监控',
  Settings: '设置',
};

export default function RootNavigator() {
  const { ready, complete } = useConfig();
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {complete ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          // 未配置时直接把连接表单当根页：填完保存后整棵树切到主界面
          <Stack.Screen name="Setup" component={ServerSettingsScreen} />
        )}
        <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ presentation: 'modal', ...subHeader('物品详情') }} />
        <Stack.Screen name="PlanReview" component={PlanReviewScreen} options={subHeader('合成计划')} />
        <Stack.Screen name="ServerSettings" component={ServerSettingsScreen} options={subHeader('服务器连接')} />
        <Stack.Screen name="IconPack" component={IconPackScreen} options={subHeader('图标库')} />
        <Stack.Screen name="CacheDetail" component={CacheScreen} options={subHeader('存储与缓存')} />
        <Stack.Screen name="About" component={AboutScreen} options={subHeader('关于')} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
