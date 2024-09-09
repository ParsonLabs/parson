import type { MDXComponents } from 'mdx/types';
import defaultComponents from 'fumadocs-ui/mdx';
import { Callout } from "fumadocs-ui/components/callout"
import { Folder, Files, File } from "fumadocs-ui/components/files"
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { Steps, Step } from "fumadocs-ui/components/steps"
import { Table, TableHeader, TableBody, TableHead, TableCell, TableRow } from "@music/ui/components/table"
import { SquareArrowOutUpRight, CirclePlus } from "lucide-react"

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...defaultComponents,
    ...components,
    Callout,
    ImageZoom,
    Steps,
    Step,
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableCell,
    TableRow,
    Folder,
    Files,
    File,
    SquareArrowOutUpRight,
    CirclePlus
  };
}
