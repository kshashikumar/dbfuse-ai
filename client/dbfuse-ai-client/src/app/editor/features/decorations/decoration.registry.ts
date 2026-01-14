import { Injectable } from '@angular/core';
import { DecorationMeta } from './decoration.types';

@Injectable({ providedIn: 'root' })
export class MonacoDecorationRegistry {
    private registry = new Map<string, DecorationMeta | undefined>();

    register(ids: string[], metas: Array<DecorationMeta | undefined>): void {
        ids.forEach((id, index) => {
            this.registry.set(id, metas[index]);
        });
    }

    getMeta(id: string): DecorationMeta | undefined {
        return this.registry.get(id);
    }

    clear(ids: string[]): void {
        ids.forEach((id) => this.registry.delete(id));
    }
}
