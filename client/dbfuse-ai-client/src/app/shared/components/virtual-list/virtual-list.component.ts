import { CommonModule } from '@angular/common';
import { Component, ContentChild, Input, TemplateRef, TrackByFunction } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';

@Component({
    selector: 'app-virtual-list',
    standalone: true,
    imports: [CommonModule, ScrollingModule],
    templateUrl: './virtual-list.component.html',
})
export class VirtualListComponent<T = unknown> {
    @Input() items: T[] | null = [];
    @Input() loading = false;
    @Input() itemSize = 40;
    @Input() loadingText = 'Loading...';
    @Input() emptyText = 'No items found.';
    @Input() emptyIcon: string | null = null;
    @Input() emptyIconClass = 'w-4 h-4 text-muted-foreground';
    @Input() containerClass = 'h-full w-full';
    @Input() viewportClass = 'h-full w-full scrollbar-hidden';
    @Input() trackByFn?: TrackByFunction<T>;

    @ContentChild(TemplateRef) itemTemplate?: TemplateRef<{ $implicit: T }>;

    get hasItems(): boolean {
        return Array.isArray(this.items) && this.items.length > 0;
    }

    readonly trackBy = (index: number, item: T): any => {
        return this.trackByFn ? this.trackByFn(index, item) : index;
    };
}
