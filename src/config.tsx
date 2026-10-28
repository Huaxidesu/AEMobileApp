// 全局服务器配置上下文：始终指向「当前账号」，切换账号后 reload 让各屏重新连接
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isConfigComplete, ServerConfig } from './api';
import { accountLabel, getActiveAccount, loadActiveConfig } from './accounts';

interface ConfigCtx {
  config: ServerConfig;
  /** 当前账号的显示名（备注名 → 线路名 → 地址） */
  accountName: string;
  ready: boolean;
  complete: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<ConfigCtx>(null as any);

/** 还没读到账号时的占位配置：地址/密码留空，界面会落到连接表单 */
const EMPTY_CONFIG: ServerConfig = { scheme: 'tcp', ip: '', port: '44444', token: '', mainnet: null };

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ServerConfig>(EMPTY_CONFIG);
  const [accountName, setAccountName] = useState('');
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    // 读账号不能把整棵树卡住：出错就退到空配置（= 去连接表单），
    // 否则 ready 永远是 false，RootNavigator 只剩一个空 View，看起来就是「黑屏」。
    try {
      setConfig(loadActiveConfig());
      setAccountName(accountLabel(getActiveAccount()));
    } catch (e) {
      console.warn('[config] 读取账号失败', e);
      setConfig(EMPTY_CONFIG);
      setAccountName('');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Ctx.Provider value={{ config, accountName, ready, complete: isConfigComplete(config), reload }}>{children}</Ctx.Provider>
  );
}

export function useConfig(): ConfigCtx {
  return useContext(Ctx);
}
