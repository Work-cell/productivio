import { Router, type IRouter } from "express";
import assistantRouter from "./assistant";
import healthRouter from "./health";
import integrationsRouter from "./integrations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(integrationsRouter);
router.use(assistantRouter);

export default router;
