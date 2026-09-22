import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, User, Application, setAuthToken, getAuthToken } from '../api/client';

interface AuthContextType {
  user: User | null;
  token: string | null;
  activeApp: Application | null;
  applications: Application[];
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  setActiveApp: (app: Application | null) => void;
  refreshApplications: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(getAuthToken());
  const [activeApp, setActiveAppState] = useState<Application | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshApplications = useCallback(async () => {
    try {
      const apps = await api.listApplications({ status: 'ALL' });
      setApplications(apps);
      // If no active app is set or current active app is archived/no longer exists, select first active app
      const activeApps = apps.filter((a) => a.status !== 'ARCHIVED');
      setActiveAppState((current) => {
        if (current && activeApps.some((a) => a.id === current.id)) {
          return current;
        }
        return activeApps.length > 0 ? activeApps[0] : null;
      });
    } catch (_e) {
      // ignore applications fetch error
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setTokenState(null);
    setUser(null);
    setActiveAppState(null);
    setApplications([]);
  }, []);

  // Check existing session on startup
  useEffect(() => {
    async function initAuth() {
      const storedToken = getAuthToken();
      if (!storedToken) {
        setIsLoading(false);
        return;
      }
      try {
        const { user: profile } = await api.me();
        setUser(profile);
        setTokenState(storedToken);
        await refreshApplications();
      } catch (_err) {
        logout();
      } finally {
        setIsLoading(false);
      }
    }
    initAuth();
  }, [logout, refreshApplications]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await api.login({ email, password });
      setAuthToken(res.token);
      setTokenState(res.token);
      setUser(res.user);
      await refreshApplications();
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email: string, password: string, displayName?: string) => {
    setIsLoading(true);
    try {
      const res = await api.signup({ email, password, displayName });
      setAuthToken(res.token);
      setTokenState(res.token);
      setUser(res.user);
      await refreshApplications();
    } finally {
      setIsLoading(false);
    }
  };

  const setActiveApp = (app: Application | null) => {
    setActiveAppState(app);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        activeApp,
        applications,
        isLoading,
        login,
        signup,
        logout,
        setActiveApp,
        refreshApplications,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
