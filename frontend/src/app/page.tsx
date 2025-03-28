'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

export default function Home() {
  const { signOut } = useAuthenticator();

  return (
    <main>
      <button onClick={signOut}>Sign out</button>
    </main>
  );
}
