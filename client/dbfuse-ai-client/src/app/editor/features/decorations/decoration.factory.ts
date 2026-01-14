import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { DecorationDescriptor, DecorationMeta } from './decoration.types';

const severityClassMap: Record<string, string> = {
    info: 'decor-info',
    warning: 'decor-warning',
    error: 'decor-error',
    'ai-hint': 'decor-ai-hint',
};

export function buildDecoration(descriptor: DecorationDescriptor): {
    range: monaco.IRange;
    options: monaco.editor.IModelDecorationOptions;
} {
    const inlineClass = severityClassMap[descriptor.meta.severity ?? 'info'];

    return {
        range: descriptor.range,
        options: {
            hoverMessage: descriptor.meta.message ? { value: descriptor.meta.message } : undefined,
            inlineClassName: `decor-inline ${inlineClass}`,
            stickiness: 1,
        },
    };
}

export function buildDecorations(descriptors: DecorationDescriptor[]) {
    return descriptors.map((descriptor) => ({
        ...buildDecoration(descriptor),
        meta: descriptor.meta,
    }));
}
