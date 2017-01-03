﻿import Mongoose = require("mongoose");
import {Types} from 'mongoose';
import {field, document} from '../../mongoose/decorators'; 
import {Strict} from '../../mongoose/enums/';

@document({ name: 'course', strict: Strict.throw })
export class course {
    schema(): {} {
        return {
            '_id': Mongoose.Schema.Types.ObjectId,
            'name': String
        };
    }

    @field({ primary: true, autogenerated: true })
    _id: Types.ObjectId;

    @field()
    name: String;
}

export default course;