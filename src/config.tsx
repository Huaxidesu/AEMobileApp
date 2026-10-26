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

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ServerConfig>({ scheme: 'http', ip: '', port: '44444', uuid: '', mainnet: null });
  const [accountName, setAccountName] = useState('');
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    setConfig(loadActiveConfig());
    setAccountName(accountLabel(getActiveAccount()));
    setReady(true);
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
