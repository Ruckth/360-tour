export interface ReviewAuthor {
	name: string;
	city: string;
	country: string;
	avatarUrl: string;
}

export interface Review {
	id: string;
	propertyId: string;
	author: ReviewAuthor;
	rating: number;
	title: string;
	body: string;
	date: string;
	verified: boolean;
	photos?: string[];
}

export interface TourReviewSnippet {
	id: string;
	roomId: string;
	position: [number, number, number];
	quote: string;
	authorName: string;
	authorCity: string;
	rating: number;
}

export interface RatingBreakdown {
	cleanliness: number;
	accuracy: number;
	communication: number;
	location: number;
	checkIn: number;
	value: number;
}

export interface RecentBooking {
	name: string;
	city: string;
	propertyId: string;
	dates: string;
	timeAgo: string;
}

export interface PropertySocialProof {
	propertyId: string;
	overallRating: number;
	totalReviews: number;
	isSuperhost: boolean;
	breakdown: RatingBreakdown;
	reviews: Review[];
	tourSnippets: TourReviewSnippet[];
	recentBookings: RecentBooking[];
}
