export function scrollInspectorToolbar(event: React.MouseEvent<HTMLElement>, direction: -1 | 1): void {
    const scrollArea = event.currentTarget.parentElement?.querySelector<HTMLElement>('.ScrollableShadows__inner')
    scrollArea?.scrollBy({ left: direction * scrollArea.clientWidth * 0.75, behavior: 'smooth' })
}
