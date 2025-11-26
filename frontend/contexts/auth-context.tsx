'use client';

import { createContext, useContext } from 'react';
import { UserAttributeKey } from '@aws-amplify/auth';
import { AuthEventData } from '@aws-amplify/ui';

type UserAttributes = Partial<Record<UserAttributeKey, string>>;

interface AuthContextType {
  user: UserAttributes | null;
  signOut: ((data?: AuthEventData | undefined) => void) | undefined;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = AuthContext.Provider;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
