import { Router, type IRouter } from "express";
import healthRouter from "./health";
import webhookRouter from "./webhook";
import signalsRouter from "./signals";
import symbolsRouter from "./symbols";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(webhookRouter);
router.use(signalsRouter);
router.use(symbolsRouter);
router.use(settingsRouter);

export default router;
