import { pageTree } from '../source';
import { DocsLayout } from 'fumadocs-ui/layout';
import { RollButton } from "fumadocs-ui/components/roll-button"
import type { ReactNode } from 'react';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: "ParsonLabs Documentation",
    template: "%s | ParsonLabs Documentation"
  }
}

export default function RootDocsLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={pageTree} nav={{ title: 'ParsonLabs Music' }}>
      <RollButton />
      {children}
    </DocsLayout>
  );
}
