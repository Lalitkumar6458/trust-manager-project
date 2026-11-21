import ControlShell from '@/components/control/ControlShell';

export const metadata = { title: 'Control panel', robots: { index: false, follow: false } };

export default function ControlLayout({ children }) {
  return <ControlShell>{children}</ControlShell>;
}
