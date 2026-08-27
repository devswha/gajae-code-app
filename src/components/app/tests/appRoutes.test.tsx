import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidElement } from 'react';
import { Navigate, matchRoutes, type RouteObject } from 'react-router-dom';

import {
  appShellRoutePaths,
  rootFallbackRoutePath,
} from '../appRoutes';

const appRoutes: RouteObject[] = [
  ...appShellRoutePaths.map((path) => ({ path, element: <output>root shell</output> })),
  { path: rootFallbackRoutePath, element: <Navigate to="/" replace /> },
];

test('Given the current application routes when matching the root then the root shell route is selected', () => {
  const matches = matchRoutes(appRoutes, '/');

  assert.equal(matches?.at(-1)?.route.path, '/');
});

test('Given stale Jobs or unknown paths when matching routes then the root replace redirect is selected', () => {
  for (const pathname of ['/jobs/new', '/jobs/job-123', '/unknown-path']) {
    const matches = matchRoutes(appRoutes, pathname);
    const route = matches?.at(-1)?.route;

    assert.equal(route?.path, '*', pathname);
    assert.ok(isValidElement(route?.element), pathname);
    assert.equal(route.element.type, Navigate, pathname);
    // React 19 types ReactElement.props as unknown; the assertion narrows it.
    const elementProps = route.element.props as { to?: unknown; replace?: unknown };
    assert.equal(elementProps.to, '/', pathname);
    assert.equal(elementProps.replace, true, pathname);
  }
});
