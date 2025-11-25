'use client';

import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { ResourcesConfig } from '@aws-amplify/core';
import { fetchAuthSession, signInWithRedirect, signOut, fetchUserAttributes } from '@aws-amplify/auth';
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

  useEffect(() => {
    async function verifyUserAuthenticated() {
      try {
        const session = await fetchAuthSession();
        if (!session.tokens) {
          // Only redirect if we're in the browser and not already on a redirect
          if (typeof window !== 'undefined' && !window.location.href.includes('code=')) {
            await signInWithRedirect({
              provider: {
                custom: 'azure',
              },
            });
          }
        } else {
          const expiryTime = session.tokens.accessToken?.payload?.exp ?? -999;
          const currentTime = new Date().getTime() / 1000;

          if (expiryTime < currentTime) {
            console.log('Token expired. Signing out.');
            await signOut();
          } else {
            // Fetch user attributes if session is valid
            const userAttributes = await fetchUserAttributes();
            setUser(userAttributes);
          }
        }
      } catch (error) {
        console.error('Authentication error:', error);
        // Don't redirect on error, just set loading to false
      } finally {
        setIsLoading(false);
      }
    }

    verifyUserAuthenticated();
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>; // Or your loading component
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
