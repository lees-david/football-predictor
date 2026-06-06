from fastapi import APIRouter
from . import auth, users, leagues, fixtures, match_predictions, bracket, rankings, tournaments, admin, simulate, email, results, audit, maintenance

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(leagues.router, prefix="/leagues", tags=["leagues"])
api_router.include_router(fixtures.router, prefix="/fixtures", tags=["fixtures"])
api_router.include_router(match_predictions.router, prefix="/match-predictions", tags=["match-predictions"])
api_router.include_router(bracket.router, prefix="/bracket", tags=["bracket"])
api_router.include_router(rankings.router, prefix="/rankings", tags=["rankings"])
api_router.include_router(tournaments.router, prefix="/tournaments", tags=["tournaments"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(simulate.router, prefix="/admin/simulate", tags=["simulate"])
api_router.include_router(email.router, prefix="/admin/email", tags=["email"])
api_router.include_router(results.router, prefix="/admin/results", tags=["results"])
api_router.include_router(audit.router, prefix="/admin", tags=["audit"])
api_router.include_router(maintenance.router, prefix="/maintenance", tags=["maintenance"])
