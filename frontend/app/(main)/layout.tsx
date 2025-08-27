'use client';

import { useState, useEffect } from 'react';
import {
  Authenticator,
  Button,
  Heading,
  Image,
  Theme,
  ThemeProvider,
  useAuthenticator,
  useTheme,
  View,
} from '@aws-amplify/ui-react';
import { Amplify } from 'aws-amplify';
import { ResourcesConfig } from '@aws-amplify/core';
import { Toaster } from 'sonner';
import { Turnstile } from 'next-turnstile';
import { AlertCircle } from 'lucide-react';
import SidebarLayout from '@/components/layout/sidebar-layout';

import '@aws-amplify/ui-react/styles.css';

const config: ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
    },
  },
};

Amplify.configure(config, { ssr: true });

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const { tokens } = useTheme();

  // Use test key for localhost, environment variable for production
  const turnstileSiteKey =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'
      ? '1x00000000000000000000AA'
      : process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;

  const theme: Theme = {
    name: 'Auth Example Theme',
    tokens: {
      components: {
        authenticator: {
          router: {
            boxShadow: `0 0 16px ${tokens.colors.overlay['10']}`,
            borderWidth: '0',
          },
          form: {
            padding: `${tokens.space.medium} ${tokens.space.xl} ${tokens.space.medium}`,
          },
        },
        button: {
          primary: {
            backgroundColor: '#01A89E',
          },
          link: {
            color: '#01A89E',
          },
        },
        fieldcontrol: {
          _focus: {
            boxShadow: `0 0 0 2px #01A89E`,
          },
        },
        tabs: {
          item: {
            color: tokens.colors.neutral['80'],
            _active: {
              borderColor: tokens.colors.neutral['100'],
              color: '#01A89E',
            },
          },
        },
      },
    },
  };

  const components = {
    Header() {
      const { tokens } = useTheme();

      return (
        <View textAlign='center' padding={tokens.space.large} paddingTop='6rem'>
          <Image alt='Task Genie' src='logo.jpg' width={54} />
          <Heading level={4}>Task Genie</Heading>
        </View>
      );
    },

    SignIn: {
      Header() {
        const { tokens } = useTheme();

        return (
          <Heading padding={`${tokens.space.xl} 0 0 ${tokens.space.xl}`} level={4}>
            Sign in to your account
          </Heading>
        );
      },
      Footer() {
        const { toForgotPassword } = useAuthenticator();
        const [turnstileStatus, setTurnstileStatus] = useState<'success' | 'error' | 'expired' | 'required'>(
          'required'
        );
        const [error, setError] = useState<string | null>(null);

        // Effect to disable the Sign in button until turnstile is successful
        useEffect(() => {
          const disableSignInButton = () => {
            // Target the specific Amplify button with the exact classes you provided
            const signInButton = document.querySelector(
              'button.amplify-button.amplify-field-group__control.amplify-button--primary[type="submit"]'
            ) as HTMLButtonElement;

            if (signInButton && signInButton.textContent?.trim() === 'Sign in') {
              const shouldDisable = turnstileStatus !== 'success';

              signInButton.disabled = shouldDisable;
              signInButton.style.opacity = shouldDisable ? '0.5' : '1';
              signInButton.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';

              if (shouldDisable) {
                signInButton.title = 'Please complete the security check first';
              } else {
                signInButton.removeAttribute('title');
              }
            }
          };

          // Run immediately and then set up an interval to check periodically
          disableSignInButton();
          const interval = setInterval(disableSignInButton, 500);

          return () => clearInterval(interval);
        }, [turnstileStatus]);

        return (
          <View textAlign='center'>
            <Turnstile
              siteKey={turnstileSiteKey}
              retry='auto'
              refreshExpired='auto'
              onError={() => {
                setTurnstileStatus('error');
                setError('Security check failed. Please try again.');
              }}
              onExpire={() => {
                setTurnstileStatus('expired');
                setError('Security check expired. Please verify again.');
              }}
              onLoad={() => {
                setTurnstileStatus('required');
                setError(null);
              }}
              onVerify={() => {
                setTurnstileStatus('success');
                setError(null);
              }}
            />
            {error && (
              <div className='flex items-center gap-2 text-red-500 text-sm mb-2' aria-live='polite'>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            {turnstileStatus === 'success' && (
              <Button fontWeight='normal' onClick={toForgotPassword} size='small' variation='link'>
                Reset Password
              </Button>
            )}
            {turnstileStatus !== 'success' && (
              <div className='text-sm text-gray-500 mb-2'>Please complete the security check above</div>
            )}
          </View>
        );
      },
    },

    SignUp: {
      Header() {
        const { tokens } = useTheme();

        return (
          <Heading padding={`${tokens.space.xl} 0 0 ${tokens.space.xl}`} level={4}>
            Create a new account
          </Heading>
        );
      },
      Footer() {
        const { toSignIn } = useAuthenticator();
        const [turnstileStatus, setTurnstileStatus] = useState<'success' | 'error' | 'expired' | 'required'>(
          'required'
        );
        const [error, setError] = useState<string | null>(null);

        // Effect to disable the Sign up button until turnstile is successful
        useEffect(() => {
          const disableSignUpButton = () => {
            // Target the specific Amplify button with the exact classes you provided
            const signUpButton = document.querySelector(
              'button.amplify-button.amplify-field-group__control.amplify-button--primary.amplify-button--fullwidth[type="submit"]'
            ) as HTMLButtonElement;

            if (signUpButton && signUpButton.textContent?.trim() === 'Create Account') {
              const shouldDisable = turnstileStatus !== 'success';

              signUpButton.disabled = shouldDisable;
              signUpButton.style.opacity = shouldDisable ? '0.5' : '1';
              signUpButton.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';

              if (shouldDisable) {
                signUpButton.title = 'Please complete the security check first';
              } else {
                signUpButton.removeAttribute('title');
              }
            }
          };

          // Run immediately and then set up an interval to check periodically
          disableSignUpButton();
          const interval = setInterval(disableSignUpButton, 500);

          return () => clearInterval(interval);
        }, [turnstileStatus]);

        return (
          <View textAlign='center'>
            <Turnstile
              siteKey={turnstileSiteKey}
              retry='auto'
              refreshExpired='auto'
              onError={() => {
                setTurnstileStatus('error');
                setError('Security check failed. Please try again.');
              }}
              onExpire={() => {
                setTurnstileStatus('expired');
                setError('Security check expired. Please verify again.');
              }}
              onLoad={() => {
                setTurnstileStatus('required');
                setError(null);
              }}
              onVerify={() => {
                setTurnstileStatus('success');
                setError(null);
              }}
            />
            {error && (
              <div className='flex items-center gap-2 text-red-500 text-sm mb-2' aria-live='polite'>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            {turnstileStatus === 'success' && (
              <Button fontWeight='normal' onClick={toSignIn} size='small' variation='link'>
                Back to Sign In
              </Button>
            )}
            {turnstileStatus !== 'success' && (
              <div className='text-sm text-gray-500 mb-2'>Please complete the security check above</div>
            )}
          </View>
        );
      },
    },
  };

  const formFields = {
    signUp: {
      username: {
        label: 'Email:',
        placeholder: 'Enter your email',
        order: 1,
      },
      password: {
        order: 2,
      },
      confirm_password: {
        order: 3,
      },
    },
  };

  return (
    <ThemeProvider theme={theme}>
      <Authenticator formFields={formFields} components={components}>
        {({ signOut, user }) => (
          <main>
            <SidebarLayout user={user} signOut={signOut}>
              {children}
              <Toaster richColors />
            </SidebarLayout>
          </main>
        )}
      </Authenticator>
    </ThemeProvider>
  );
};

export default MainLayout;
