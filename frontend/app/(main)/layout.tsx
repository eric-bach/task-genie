'use client';

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

        return (
          <View textAlign='center'>
            <Button fontWeight='normal' onClick={toForgotPassword} size='small' variation='link'>
              Reset Password
            </Button>
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

        return (
          <View textAlign='center'>
            <Button fontWeight='normal' onClick={toSignIn} size='small' variation='link'>
              Back to Sign In
            </Button>
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
