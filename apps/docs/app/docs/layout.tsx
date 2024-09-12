import { source } from '@/app/source';
import { RootToggle } from "fumadocs-ui/components/layout/root-toggle";
import { DocsLayout } from 'fumadocs-ui/layout';
import type { ReactNode } from 'react';
import { baseOptions } from '../layout.config';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree} {...baseOptions}
      sidebar={{
        banner: (
          <RootToggle
            options={[
              {
                title: 'Music',
                description: 'Documentation on the ParsonLabs Music project and its subsidiaries.',
                url: '/docs/music',
              },
              {
                title: 'Developers',
                description: 'The developer guide for the ParsonLabs Music GitHub repository.',
                url: '/docs/dev',
              },
            ]}
          />
        ),
      }}>
      {children}
    </DocsLayout>
  );
}
