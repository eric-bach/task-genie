'use client';

import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { ResourcesConfig } from '@aws-amplify/core';
import { fetchAuthSession, fetchUserAttributes } from '@aws-amplify/auth';
import { Toaster } from 'sonner';
import SidebarLayout from '@/components/layout/sidebar-layout';

import '@aws-amplify/ui-react/styles.css';

const config: ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
      loginWith: {
        oauth: {
          domain: process.env.NEXT_PUBLIC_DOMAIN!,
          scopes: ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'],
          redirectSignIn: [process.env.NEXT_PUBLIC_REDIRECT_URL!],
          redirectSignOut: [process.env.NEXT_PUBLIC_REDIRECT_URL!],
          responseType: 'code',
          providers: [
            {
              custom: 'azure',
            },
          ],
        },
      },
    },
  },
};

Amplify.configure(config, { ssr: true });

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function checkAuthState() {
      try {
        const session = await fetchAuthSession();

        if (session.tokens) {
          const expiryTime = session.tokens.accessToken?.payload?.exp ?? -999;
          const currentTime = new Date().getTime() / 1000;

          if (expiryTime >= currentTime) {
            // Valid session
            const userAttributes = await fetchUserAttributes();
            setUser(userAttributes);
            setIsAuthenticated(true);
          } else {
            // Expired session
            setIsAuthenticated(false);
          }
        } else {
          // No session
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    }

    checkAuthState();
  }, []);

  const handleSignOut = async () => {
    try {
      // Instead of using Amplify's signOut, redirect to logout URL
      const domain = process.env.NEXT_PUBLIC_DOMAIN!;
      const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
      const redirectUrl = process.env.NEXT_PUBLIC_REDIRECT_URL!;

      window.location.href = `https://${domain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(
        redirectUrl
      )}`;
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const handleSignIn = () => {
    // Redirect to login page
    const domain = process.env.NEXT_PUBLIC_DOMAIN!;
    const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
    const redirectUrl = process.env.NEXT_PUBLIC_REDIRECT_URL!;

    window.location.href = `https://${domain}/oauth2/authorize?identity_provider=azure&redirect_uri=${encodeURIComponent(
      redirectUrl
    )}&response_type=code&client_id=${clientId}&scope=openid+email+profile+aws.cognito.signin.user.admin`;
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div>Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-center'>
          <h1 className='text-2xl mb-4'>Please sign in</h1>
          <button onClick={handleSignIn} className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600'>
            Sign in with Azure
          </button>
        </div>
      </div>
    );
  }

  return (
    <main>
      <SidebarLayout user={user} signOut={handleSignOut}>
        {children}
        <Toaster richColors />
      </SidebarLayout>
    </main>
  );
};

export default MainLayout;
