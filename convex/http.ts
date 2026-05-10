import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = auth.http();

async function requireProject(ctx: any, projectId: string) {
  const project = await ctx.runQuery(internal.issues.getProjectForApi, {
    projectId,
  });
  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return project;
}

http.route({
  path: "/api/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authContext = await auth.request.context(ctx, request);
    return Response.json({
      userId: authContext.userId,
      groupId: authContext.groupId,
      role: authContext.role,
      grants: authContext.grants,
      source: authContext.source,
      keyId: authContext.key?.keyId ?? null,
    });
  }),
});

http.route({
  path: "/api/issues",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authContext = await auth.request.context(ctx, request);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      return Response.json(
        { error: "Missing required query parameter `projectId`." },
        { status: 400 },
      );
    }
    const project = await requireProject(ctx, projectId);
    if (project instanceof Response) {
      return project;
    }
    await auth.member.require(ctx, {
      userId: authContext.userId,
      groupId: project.groupId,
      grants: ["projects.read"],
    });
    if (authContext.source === "key" && !authContext.key.scopes.can("issues", "read")) {
      return Response.json(
        { error: "This API key does not have issues.read access." },
        { status: 403 },
      );
    }
    const issues = await ctx.runQuery(internal.issues.listIssuesForApi, {
      projectId,
    });
    return Response.json({
      project: {
        projectId: project.projectId,
        name: project.name,
        identifier: project.identifier,
      },
      issues: issues.map((issue: any) => ({
        issueId: issue.issueId,
        identifier: `${project.identifier}-${issue.number}`,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        labels: issue.labels ?? [],
      })),
    });
  }),
});

http.route({
  path: "/api/issues",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authContext = await auth.request.context(ctx, request);
    const body = (await request.json()) as {
      projectId?: string;
      title?: string;
      description?: string;
    };
    if (!body.projectId || !body.title?.trim()) {
      return Response.json(
        { error: "Expected `projectId` and `title` in the request body." },
        { status: 400 },
      );
    }
    const project = await requireProject(ctx, body.projectId);
    if (project instanceof Response) {
      return project;
    }
    await auth.member.require(ctx, {
      userId: authContext.userId,
      groupId: project.groupId,
      grants: ["issues.create"],
    });
    if (authContext.source === "key" && !authContext.key.scopes.can("issues", "write")) {
      return Response.json(
        { error: "This API key does not have issues.write access." },
        { status: 403 },
      );
    }
    const created = await ctx.runMutation(internal.issues.createIssueForApi, {
      projectId: body.projectId,
      userId: authContext.userId,
      title: body.title,
      description: body.description,
    });
    return Response.json({
      issueId: created.issueId,
      identifier: `${project.identifier}-${created.number}`,
    });
  }),
});

export default http;
