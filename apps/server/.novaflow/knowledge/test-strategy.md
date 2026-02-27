# Test Stategy

We should have playwright tests that run against MSW mocks for integration tests.
We should also have playwright tests that run against a deployed environment or the localhost.
The two should be independent, indepenently executable but share utilities, locators and page objects if possible.

