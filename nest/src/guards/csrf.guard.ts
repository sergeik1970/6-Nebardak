import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { Request } from "express";
import { getRuntimeConfig } from "../config/runtime.config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-requested-with";
export const CSRF_HEADER_VALUE = "stylefinder";

/**
 * Session cookies ride along with every browser request, so each state
 * change must prove it came from our own pages. A custom header cannot be
 * sent cross-origin without a CORS preflight, which this API never grants;
 * Origin and Fetch Metadata reject the remaining browser cases early.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        if (context.getType() !== "http") return true;

        const request = context.switchToHttp().getRequest<Request>();
        if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

        const origin = request.headers.origin;
        const fetchSite = request.headers["sec-fetch-site"];
        if (
            request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE ||
            (origin !== undefined &&
                origin !== getRuntimeConfig().publicOrigin) ||
            fetchSite === "cross-site" ||
            fetchSite === "same-site"
        ) {
            throw new ForbiddenException("Запрос отклонён");
        }

        return true;
    }
}
