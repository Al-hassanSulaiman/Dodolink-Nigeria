import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storesRouter from "./stores";
import productsRouter from "./products";
import searchRouter from "./search";
import messagesRouter from "./messages";
import reviewsRouter from "./reviews";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storesRouter);
router.use(productsRouter);
router.use(searchRouter);
router.use(messagesRouter);
router.use(reviewsRouter);

export default router;
