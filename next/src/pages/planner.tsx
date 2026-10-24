import React from "react";
import ProjectScope from "@/shared/lib/project-scope/ProjectScope";
import DrawRoom from "@/shared/pages/DrawRoom";

/** The apartment planner: walls, doors and windows, rooms, furniture and the result. */
const PlannerPage: React.FC = () => (
    <ProjectScope>
        <DrawRoom />
    </ProjectScope>
);

export default PlannerPage;
