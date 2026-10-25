import { useRouter } from "next/router";
import { useEffect } from "react";
import { withProjectParam } from "@/shared/lib/project-scope/storage";

/**
 * A former step of the project path. Bookmarks and links in old emails still
 * land here; they continue in the apartment planner with the same project.
 */
export default function PlannerRedirect() {
    const router = useRouter();
    useEffect(() => {
        if (!router.isReady) return;
        const project = typeof router.query.project === "string" ? router.query.project : null;
        void router.replace(withProjectParam("/planner", project));
    }, [router]);
    return null;
}
