import { source } from "../../lib/source";
import { baseOptions } from "../../lib/layout.shared";
import { AppChrome } from "../../components/app-chrome";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppChrome />
      <DocsLayout
        {...baseOptions()}
        tree={source.getPageTree()}
        sidebar={{ enabled: false }}
        searchToggle={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </>
  );
}
