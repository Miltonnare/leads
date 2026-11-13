import type { Metadata } from 'next';
import { ChameleonContent } from '@/components/ChameleonContent';
import { resolvePreview, type PreviewQuery } from '@/lib/preview';

interface PageProps { searchParams?: PreviewQuery }

export function generateMetadata({ searchParams }: PageProps): Metadata {
  return { title: resolvePreview(searchParams).client + ' | Project inquiry' };
}

export default function ChameleonPage({ searchParams }: PageProps) {
  return <ChameleonContent preview={resolvePreview(searchParams)} />;
}
