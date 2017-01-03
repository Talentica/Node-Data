
import {inject, service} from '../../di/decorators';
import {ServiceA} from './service-a';
import {ServiceB} from './service-b';
import {ServiceC} from './service-c';

export class ServiceD {

    public serviceA: ServiceA;
    public serviceB: ServiceB;
    public serviceC: ServiceC;

    constructor(serviceA: ServiceA, serviceB: ServiceB, serviceC: ServiceC) {
        this.serviceA = serviceA;
        this.serviceB = serviceB;
        this.serviceC = serviceC;
    }
}