import { UserAttributeKey } from 'aws-amplify/auth';
import { AuthEventData } from '@aws-amplify/ui';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';

type LayoutProps = {
  user: Partial<Record<UserAttributeKey, string>> | null;
  signOut: ((data?: AuthEventData | undefined) => void) | undefined;
  children: React.ReactNode;
};

const SidebarLayout = ({ user, signOut, children }: LayoutProps) => {
  return (
    <SidebarProvider>
      <AppSidebar user={user} signOut={signOut} />
      {/* <SidebarTrigger /> */}
      {children}
    </SidebarProvider>
  );
};

export default SidebarLayout;
