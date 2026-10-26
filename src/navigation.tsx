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

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

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
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ presentation: 'modal', headerShown: true, headerTitle: '物品详情', headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }} />
            <Stack.Screen name="PlanReview" component={PlanReviewScreen} options={{ headerShown: true, headerTitle: '合成计划', headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }} />
          </>
        ) : (
          <Stack.Screen name="Setup" component={SettingsScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
