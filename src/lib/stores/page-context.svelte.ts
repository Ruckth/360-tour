class PageContext {
	propertySlug = $state('');
	propertyName = $state('');

	setProperty(slug: string, name: string) {
		this.propertySlug = slug;
		this.propertyName = name;
	}

	clear() {
		this.propertySlug = '';
		this.propertyName = '';
	}
}

export const pageContext = new PageContext();
